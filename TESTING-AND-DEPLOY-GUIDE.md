# Prompify — Testing & Deploy Guide (reconciled branch `feat/persistence-on-euleros`)

Branch = EulerOS (company/billing/auth base) + ALL v2 features (persistence, app-data, design, UI).
Verified locally: typecheck 0 errors, lint 0 errors, production build OK. NOT yet runtime-tested.

Prod VM:    159.138.244.247 (prompify.com), repo ~/prompifyChulaDev, currently on branch `EulerOS`
Staging VM: GCP `prompify-vm`, zone asia-southeast1-c, user prompifysup, repo /data/prompify
Every docker compose command uses:  --profile production
NEVER remove the postgres_data volume on PROD. NEVER `down -v` on prod.

=====================================================================
PART A — TEST ON STAGING (do this first; nothing goes to prod until this passes)
=====================================================================

## A1. SSH into staging
- `gcloud compute ssh prompify-vm --zone=asia-southeast1-c`
- `cd /data/prompify`

## A2. Pull the reconciled branch
- `sudo git fetch origin`
- `sudo git checkout feat/persistence-on-euleros` (or `sudo git reset --hard origin/feat/persistence-on-euleros` if checkout is blocked by local changes)
- `sudo git log --oneline -1`  → should show the merge commit `ead2ed6`

## A3. Update staging .env (add persistence vars if missing)
- `grep -E 'REDIS_PASSWORD|S3_|SNAPSHOTS_ENABLED' /data/prompify/.env`
- Staging already had these (REDIS_PASSWORD, S3_*, SNAPSHOTS_ENABLED) — confirm they're present.
- Confirm `AUTH_DISABLED=true` is fine for staging (it is — test box).

## A4. Clean-schema test (recommended — staging data is disposable)
This tests that schema.sql builds the whole DB (incl. the 3 persistence tables) from scratch.
- Take a throwaway dump first (optional): `docker exec prompify-postgres pg_dump -U prompify_user -d prompify -Fc -f /tmp/staging-before.dump`
- Stop app: `sudo docker compose -f docker-compose.prod.yaml --profile production stop app`
- Wipe DB volume (STAGING ONLY — never prod):
  - `sudo docker compose -f docker-compose.prod.yaml --profile production down`
  - `docker volume rm prompifychuladev_postgres_data`  (name may differ on staging — check `docker volume ls | grep postgres`)
- (Alternative: skip the wipe to test the in-place UPGRADE path instead — closer to what prod will do.)

## A5. Rebuild + boot
- `sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build`
- Watch logs: `sudo docker compose -f docker-compose.prod.yaml --profile production logs -f app`
  - Confirm it reaches "listening", NO schema/migration errors, NO "relation ... does not exist".

## A6. Verify schema created (DBeaver or psql on staging)
- `SELECT to_regclass('codebase_versions'), to_regclass('codebase_blobs'), to_regclass('app_tables');` → all non-NULL
- `SELECT to_regclass('companies'), to_regclass('payments');` → non-NULL (EulerOS model intact)

## A7. FEATURE TEST CHECKLIST (the real proof — click through each)
EulerOS base features:
- [ ] App loads; login works (company/workspace auth)
- [ ] Workspace switcher in header works
- [ ] Billing/Plans page loads; Stripe checkout flow works
- [ ] Company/project overview loads
v2 persistence features:
- [ ] Generate an app / open a chat — codebase renders
- [ ] Manual file edit → Save → HARD REFRESH → the edit survives (snapshot persistence)
- [ ] Version-history button shows versions, each named by its change summary
- [ ] Revert to an earlier version works
- [ ] Offline test: DevTools → Network → Offline → make an edit → back Online → it syncs (drain queue)
v2 app-data + other:
- [ ] App-data: create a table in a generated app (Data section), insert a row, reload — persists
- [ ] Design-system references load; your UI changes (dark navbar etc.) look right

## A8. If a feature fails
- Capture the browser console + `docker logs prompify-app` around the failure.
- Snapshot save/load issues → check S3 creds + CORS (bucket prompify-snapshots) and the codebase_* tables.
- Paste the error; fix on the branch locally, re-push, re-pull on staging, retest.

=====================================================================
PART B — DEPLOY TO PROD (only after Part A fully passes)
=====================================================================

## B0. Pre-window (local + boss)
- [ ] Boss confirmed maintenance window (~15-30 min downtime).
- [ ] Boss confirmed IN WRITING: postgres_data volume is NOT removed.
- [ ] You have prod SSH (key + user for 159.138.244.247).
- [ ] REDIS_PASSWORD value in your password manager (prod .env will need it).
- [ ] Decide how the reconciled branch reaches prod: either deploy `feat/persistence-on-euleros`
      directly, or merge it into `EulerOS` first (cleaner: prod stays on its normal branch).

## B1. SSH in + read-only inspection
- `ssh -i ~/.ssh/<prod-key> <user>@159.138.244.247`
- `cd ~/prompifyChulaDev`
- `git branch --show-current`  → note current (EulerOS) = ROLLBACK target
- `git log --oneline -1`
- `grep -E 'AUTH_DISABLED|REDIS_PASSWORD|CRON_SECRET|S3_' ~/prompifyChulaDev/.env`  → see what's missing
- `docker ps` ; `docker volume ls | grep postgres`

## B2. Notify users
- Post maintenance banner: "Prompify under maintenance, ~15-30 min."

## B3. Safety backup ON PROD (critical)
- `docker exec prompify-postgres pg_dump -U prompify_user -d prompify -Fc -f /tmp/pre-upgrade-$(date +%F).dump`
- `docker cp prompify-postgres:/tmp/pre-upgrade-$(date +%F).dump ./`
- Confirm the file exists and is non-zero.

## B4. Stop app only (Postgres + Redis stay up)
- `sudo docker compose -f docker-compose.prod.yaml --profile production stop app`
- ⚠️ App only. NEVER `down -v`. NEVER remove postgres_data.

## B5. Pull the reconciled code
- `sudo git fetch origin`
- If deploying the branch directly: `sudo git reset --hard origin/feat/persistence-on-euleros`
- (If you merged into EulerOS first: `sudo git reset --hard origin/EulerOS`)

## B6. Update prod .env IN PLACE (add only what's missing)
- `sudo nano ~/prompifyChulaDev/.env`
  - Add `REDIS_PASSWORD=<from password manager>` (MANDATORY — compose requires it)
  - Add S3 block only if absent: S3_ENDPOINT / S3_REGION / S3_BUCKET=prompify-snapshots / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
  - Add `SNAPSHOTS_ENABLED=true` and `VITE_SNAPSHOTS_ENABLED=true` if absent
  - Confirm `AUTH_DISABLED=false` (prod MUST be false)
  - Do NOT touch POSTGRES_PASSWORD / JWT_SECRET (keep prod's real values)

## B7. Rebuild + boot app (schema reconciles on boot)
- `sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app`
- `sudo docker compose -f docker-compose.prod.yaml --profile production logs -f app`
  - createPostgresTables() runs schema.sql (idempotent): prod already has EulerOS tables, so this
    only ADDS codebase_versions / codebase_blobs / app_tables. Existing data untouched.
  - Watch for "listening" and NO schema errors.
  - If it aborts → ROLLBACK (B10).

## B8. Start aux services
- `sudo docker compose -f docker-compose.prod.yaml --profile production up -d backup cron`

## B9. Post-upgrade verification (DBeaver on prod)
- `SELECT to_regclass('codebase_versions'), to_regclass('codebase_blobs'), to_regclass('app_tables');` → all non-NULL
- Smoke test https://www.prompify.com:
  - [ ] /api/health returns uptime
  - [ ] Login works (users NOT logged out — JWT_SECRET unchanged)
  - [ ] Existing chats load; billing/company features work
  - [ ] Manual edit → save → hard refresh → survives (snapshots live on prod)
  - [ ] Version-history button works
- Remove maintenance banner; notify users.

## B10. ROLLBACK (if boot/smoke fails)
- `sudo docker compose -f docker-compose.prod.yaml --profile production stop app`
- `sudo git reset --hard origin/EulerOS`   (the branch from B1)
- Revert .env (remove REDIS_PASSWORD/SNAPSHOTS if the old app rejects them)
- `sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app`
- Data is safe (volume never removed). New persistence tables left behind are harmless to old code.
- If data looks corrupted: restore from the B3 dump.

## B11. Decommission staging (after prod is verified stable)
- Power off / delete the staging VM.
- After this, the bucket `prompify-snapshots` holds prod's live data — NEVER bulk-delete it again.
