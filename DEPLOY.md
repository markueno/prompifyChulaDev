# Prompify — production deploy

Current as of 2026-08-10. Replaces `DEPLOYMENT-2026-07-27-RUNBOOK.md`,
`TESTING-AND-DEPLOY-GUIDE.md`, `details/deployment/DEPLOYMENT-MIGRATION-GUIDE.md` and
`CONTEXT-HANDOFF-2026-07-30.md`, all of which described the *planned* in-place upgrade. That
upgrade happened on 2026-07-30; this is the steady-state procedure.

## The machine

| | |
|---|---|
| Host | Huawei VM `159.138.244.247` — live `prompify.com` |
| Repo | `~/prompifyChulaDev` |
| Deployed branch | local **`EulerOS`**, reset onto `origin/feat/persistence-on-euleros` |
| Postgres | container `prompify-postgres`, db `prompify`, user `prompify_user` |
| DB volume | `prompifychuladev_postgres_data` |

`origin/EulerOS` is the **pre-upgrade rollback branch**. The local `EulerOS` branch is only a
deploy pointer and has moved onto the feature line — **never push `EulerOS` to origin**, or the
rollback target is destroyed.

## Rules

- Every `docker compose` command needs `--profile production`. It is not set via `COMPOSE_PROFILES`.
- **Never remove `postgres_data`.** Never run `down -v`. `init-db.sql` would re-init an empty DB.
- Stop **`app` only**. Postgres and Redis stay up.
- Schema changes apply on boot via `createPostgresTables()` / `schema.sql`. Do not hand-write DDL.
- Prod `.env` must have `AUTH_DISABLED=false`. Never copy staging's `.env` over it — staging ran
  with auth disabled and a different `POSTGRES_PASSWORD`.
- `POSTGRES_PASSWORD` / `JWT_SECRET` are prod's real values. Changing `JWT_SECRET` logs everyone out.

## Deploy

```bash
cd ~/prompifyChulaDev
git log --oneline -1                       # note this — it is the rollback commit
sudo docker compose -f docker-compose.prod.yaml --profile production stop app
git fetch origin && git reset --hard origin/feat/persistence-on-euleros
sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
sudo docker compose -f docker-compose.prod.yaml --profile production logs -f app
```

Watch for `listening` and no `relation ... does not exist`. If boot aborts, roll back.

Backup first when a release touches the schema:

```bash
docker exec prompify-postgres pg_dump -U prompify_user -d prompify -Fc -f /tmp/pre-$(date +%F).dump
docker cp prompify-postgres:/tmp/pre-$(date +%F).dump ./
ls -lh pre-*.dump                          # confirm non-zero
```

## Verify

```bash
curl -s http://localhost:5173/api/health
sudo docker exec prompify-postgres psql -U prompify_user -d prompify \
  -c "SELECT to_regclass('codebase_versions'), to_regclass('codebase_blobs'), to_regclass('app_tables');"
```

Then on https://www.prompify.com: login (nobody should be forced to re-auth), existing chats load,
generation streams, edit a file → save → hard refresh → the edit survives (this exercises snapshots
+ S3/OBS + CORS), and version history lists and restores.

## Rollback

```bash
sudo docker compose -f docker-compose.prod.yaml --profile production stop app
git reset --hard <commit from step 1>
sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
```

Data is untouched — the volume is never removed. Restore from the dump only if data looks corrupt.

## Useful

```bash
# query prod
sudo docker exec prompify-postgres psql -U prompify_user -d prompify -c "SQL"
# aux services
sudo docker compose -f docker-compose.prod.yaml --profile production up -d backup cron
```

Snapshots live in the OBS bucket `prompify-snapshots` (AP-Singapore, private, CORS allows
`https://prompify.com` + `https://www.prompify.com`). It holds prod's live data — **never
bulk-delete it.**

## Related docs

- `UX-FEEDBACK-2026-08-09-PLAN.md` — most recent change set + its test checklist
- `details/security/SECURITY_NOW.md` — **two findings still open**: CRIT-2 (TLS key + JWT secret in
  git history, deferred by owner) and H-1 (company IDOR, deferred while company features are dark)
- `details/architecture/ARCHITECTURE-v2.md`, `data/DBProposal.md` — why the persistence and
  app-data layers are built the way they are
- `details/PROMPIFY-INTERNAL-DOCS.md` — engineering reference
