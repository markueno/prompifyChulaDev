# Prompify prod upgrade — window runbook (planned 2026-07-27)

Prod VM: 159.138.244.247 (prompify.com) · Repo: /data/prompify · Branch: feat/persistence-architecture-v2
Every docker compose command uses:  --profile production
NEVER remove the postgres_data volume. NEVER run `down -v`.

> SECRETS ARE NOT STORED IN THIS FILE. The real REDIS_PASSWORD lives in the password
> manager only, and is typed into prod's .env during the window. Do not paste secrets here.

## PRE-WINDOW (must be true before starting)
- [ ] Boss granted prod SSH (key + username).  Connect:  ssh -i ~/.ssh/<prod-key> <user>@159.138.244.247
- [ ] Maintenance window agreed (15-30 min downtime).
- [ ] Boss confirmed IN WRITING: postgres_data volume is NOT removed.
- [ ] DB backup dump already taken via DBeaver. Keep it.
- [ ] Preflight orphan check passed (chats with bad/NULL user_id = 0).

## STEP 0 — SSH in + read-only inspection (changes nothing)
ssh -i ~/.ssh/<prod-key> <user>@159.138.244.247
hostname
docker ps --format '{{.Names}}\t{{.Status}}'
curl -s http://localhost:5173/api/health
cd /data/prompify
git branch --show-current        # <-- WRITE THIS DOWN = OLD_BRANCH (for rollback)
git log --oneline -1
grep -E 'AUTH_DISABLED|REDIS_PASSWORD|CRON_SECRET|S3_' /data/prompify/.env   # see what's missing
docker volume ls | grep -i postgres

## STEP 1 — Notify users
Post maintenance banner: "Prompify under maintenance, ~15-30 min."

## STEP 2 — Stop staging writes to the shared bucket (on the STAGING VM, gcloud)
gcloud compute ssh prompify-vm --zone=asia-southeast1-c
  sudo docker compose -f docker-compose.prod.yaml --profile production stop app backup cron
  exit

## STEP 3 (optional) — Empty the OBS bucket (ONLY now, before prod writes)
# In the OBS console delete all objects in prompify-snapshots.
# After prod is live, NEVER bulk-delete this bucket again.

## STEP 4 — Safety backup ON PROD (critical)  [back on the prod SSH session]
docker exec prompify-postgres pg_dump -U prompify_user -d prompify -F c -f /tmp/pre-upgrade-$(date +%F).dump
docker cp prompify-postgres:/tmp/pre-upgrade-$(date +%F).dump ./
ls -lh pre-upgrade-*.dump      # confirm non-zero size

## STEP 5 — Stop the app only (Postgres + Redis stay up)
cd /data/prompify
sudo docker compose -f docker-compose.prod.yaml --profile production stop app

## STEP 6 — Pull the new code
sudo git fetch origin
sudo git reset --hard origin/feat/persistence-architecture-v2
# Do NOT apply staging's nginx-dev.conf sed edits. Prod keeps nginx-prod.conf.

## STEP 7 — Update prod's .env IN PLACE (add only what's missing)
grep -E 'REDIS_PASSWORD|CRON_SECRET|S3_' /data/prompify/.env
sudo nano /data/prompify/.env
#   - Add: REDIS_PASSWORD=<from password manager>      (MANDATORY — stack won't boot without it)
#   - Add S3_* + SNAPSHOTS_ENABLED + VITE_SNAPSHOTS_ENABLED only if absent
#   - Add CRON_SECRET only if absent (else keep prod's existing)
#   - Confirm AUTH_DISABLED=false
#   - Do NOT touch POSTGRES_PASSWORD / JWT_SECRET (keep prod's real values)

## STEP 8 — Rebuild + boot the app (schema reconciles on boot)
sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
sudo docker compose -f docker-compose.prod.yaml --profile production logs -f app
# Watch for "listening" and NO migration errors (nothing about project_id / SET NOT NULL).
# If it aborts here -> go to ROLLBACK.

## STEP 9 — Start aux services
sudo docker compose -f docker-compose.prod.yaml --profile production up -d backup cron

## STEP 10 — Verify schema (DBeaver, Section C of DEPLOYMENT-2026-07-27-PREFLIGHT.sql)
#   chats with NULL project_id  -> MUST be 0
#   proj_personal_% projects    -> MUST be > 0
#   codebase_versions / codebase_blobs / app_tables -> all exist
#   change_summary + message_id columns exist ; project_id is NOT NULL

## STEP 11 — Smoke test https://www.prompify.com
- [ ] /api/health returns uptime
- [ ] Login works (no forced re-login)
- [ ] Existing chat history loads
- [ ] New app generation + Qwen streaming works
- [ ] Snapshot: edit file -> save -> hard refresh -> edit survives (validates S3 + CORS)
- [ ] /api/cron/sleep-check returns 200

## STEP 12 — End window
Remove banner, notify users.

## STEP 13 — Decommission staging
Power off / delete the staging VM. After this, the bucket holds prod's live data — never bulk-delete it.

# ============================ ROLLBACK ============================
# If boot fails or smoke tests fail badly. Data is untouched (volume never removed).
sudo docker compose -f docker-compose.prod.yaml --profile production stop app
sudo git reset --hard origin/<OLD_BRANCH>          # the branch you wrote down in STEP 0
# Revert .env: remove REDIS_PASSWORD/SNAPSHOTS_ENABLED if the old app rejects them
sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
# If data looks corrupted, restore from the STEP 4 dump (or the DBeaver dump).
