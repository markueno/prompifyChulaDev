# Prompify — Internal Engineering Doc

The single internal reference for this repo: how to run it, how to deploy it, how it is built,
what is open, and what to keep in mind next. `README.md` is the public-facing intro and
deliberately carries no operational detail. Deep-dive originals live in [`archive/`](archive/) and
are indexed at the bottom.

**This file is tracked in git. Never put a secret value in it** — only variable names. Live values
belong in `.env` on the machine that needs them.

Last verified against the code: 2026-10-26.

---

## Table of Contents

1. [Orientation](#1-orientation)
2. [The machine](#2-the-machine)
3. [Local development](#3-local-development)
4. [Environment variables](#4-environment-variables)
5. [Production deploy](#5-production-deploy)
6. [Schema changes — read before adding a column](#6-schema-changes--read-before-adding-a-column)
7. [Architecture](#7-architecture)
8. [Data model](#8-data-model)
9. [API reference](#9-api-reference)
10. [Email — Resend](#10-email--resend)
11. [Billing — Stripe](#11-billing--stripe)
12. [Security status](#12-security-status)
13. [Keep in mind — security](#13-keep-in-mind--security)
14. [Keep in mind — deployment](#14-keep-in-mind--deployment)
15. [Open work](#15-open-work)
16. [Archive index](#16-archive-index)

---

## 1. Orientation

Prompify is an AI-powered B2B enterprise app-suite builder. A non-technical operator describes an
internal web app in plain English and gets a running app in the browser — editor, terminal and
preview included. The loop is: prompt → AI streams code into an in-browser WebContainer → live
preview in an iframe → iterate or deploy.

Unlike per-app builders, Prompify works at the **company level**: one workspace, many apps, shared
identity, shared data, RBAC and an audit log.

**Lineage.** This is a fork of bolt.diy. The oldest commit is the upstream Bolt base (2026-02-28).
A team layered auth, multi-tenancy and PostgreSQL on top from July 2025 onward. That split matters
when triaging: upstream-inherited code can often simply be deleted, whereas team-introduced code is
core to the auth model. `app/routes/api.update.ts` is the clearest live example — see section 12.

**Stack**

| Layer | Choice |
|---|---|
| Framework | Remix + Vite, React 18 |
| Runtime | Node 22.23.4 (`.tool-versions`, `Dockerfile` `ARG BASE`) |
| Prod server | compiled `server.js` over `remix vite:build` output |
| In-browser runtime | WebContainer API (Node via WASM) — needs `SharedArrayBuffer` + COOP/COEP |
| Database | PostgreSQL 15 (`pg`, parameterized; some Drizzle) |
| Sessions | Redis 7 is declared in compose but **has zero references in `app/` or `server.js`** |
| AI provider | Qwen via DashScope (transparent to users) |
| Object storage | Huawei OBS, S3-compatible, bucket `prompify-snapshots` |
| Editor / terminal | CodeMirror 6 / xterm.js |
| Deploy target for generated apps | Netlify |
| Package manager | pnpm 9.4.0 (`pnpm-lock.yaml` is the only lockfile; the stale `package-lock.json` was removed 2026-10-26) |

**Dual runtime, load-bearing.** The app was written against the Cloudflare adapter, so loaders and
actions read `context.cloudflare.env.X`. Under `node server.js` there are no Cloudflare bindings,
so `server.js` installs a shim (`loadContext = { cloudflare: { env: process.env } }`). Without it,
auth silently falls back to a default secret. Do not remove it.

Also do not delete `app/utils/process-shim.ts` (present, verified) — see
`archive/PROMPIFY-INTERNAL-DOCS.md` section 3 for why.

---

## 2. The machine

| | |
|---|---|
| Host | Huawei VM `159.138.244.247` — live `prompify.com` |
| Repo path | `~/prompifyChulaDev` (root's home, so `/root/prompifyChulaDev`) |
| Deployed branch | local **`EulerOS`**, reset onto `origin/feat/persistence-on-euleros` |
| Remote | `github.com/markueno/prompifyChulaDev` (private) |
| Postgres | container `prompify-postgres`, db `prompify`, user `prompify_user` |
| DB volume | `prompifychuladev_postgres_data` |

`origin/EulerOS` is the **pre-upgrade rollback branch**. Local `EulerOS` is only a deploy pointer
and has moved onto the feature line — **never push `EulerOS` to origin**, or the rollback target is
destroyed.

**Containers**

| Container | Image | Role |
|---|---|---|
| `prompify-app` | `bolt-ai:production` | compiled Node server, bound to `127.0.0.1:5173` |
| `prompify-postgres` | `postgres:15-alpine` | platform + runtime app data |
| `prompify-redis` | `redis:7-alpine` | declared, unused by app code |
| `prompify-nginx` | `nginx:alpine` | TLS termination, reverse proxy |
| `prompify-certbot-dev` | `certbot/certbot:latest` | Let's Encrypt renewal loop |
| `prompify-backup` | `postgres:15-alpine` | WAL archiving, pg_dump, basebackup |
| `prompify-cron` | `curlimages/curl:latest` | sleep-check, GC, inactivity nudges |

The app binds to `127.0.0.1` only — nginx is the sole public path.

A planned server migration is expected; section 14 has the checklist.

---

## 3. Local development

**Prerequisites:** Docker Desktop or Docker Engine + Compose; at least one AI provider key; a
Netlify token for deploy testing; optionally a GitHub org for code push.

### Docker Compose (primary)

```bash
docker compose -f docker-compose.prod.yaml --profile production up --build --force-recreate
```

- direct: `http://localhost:5173`
- via nginx: `https://localhost` (if certs are configured)

Every compose command needs `--profile production`. It is not set via `COMPOSE_PROFILES`.

### Without Docker

```bash
pnpm install
pnpm run build          # required before `node server.js` — see below
pnpm run dev            # or this, for the Vite dev server
```

`node server.js` imports `./build/server/index.js` at runtime, so it fails outright if `build/` is
absent. `build/` is gitignored and was deleted from this working tree on 2026-10-26; run
`pnpm run build` to recreate it. The Vite dev server (`pnpm run dev`) does not need it.

### Scripts

```bash
pnpm run dev                   # Vite dev server on :5173
pnpm run build                 # remix vite:build
pnpm run typecheck             # tsc
pnpm run lint                  # eslint
pnpm run lint:fix              # eslint --fix + prettier
pnpm run test                  # vitest --run
pnpm run test:watch            # vitest
pnpm run test:db               # database connectivity check
pnpm run test:framework-fixes  # scripts/test-framework-fixes.js
pnpm run clean                 # scripts/clean.js
pnpm run sync:backup           # scripts/daily-sync.js
pnpm run setup:cron            # scripts/setup-cron.sh — see the warning in section 14
pnpm run typegen               # wrangler types (Cloudflare leftover)
```

### Useful container commands

```bash
docker logs prompify-app -f
docker exec -it prompify-postgres psql -U prompify_user -d prompify
```

**Never** run `down -v` against prod — the Postgres image would re-run `schema.sql` on a fresh
empty volume.

### Known local gotchas

- A different project's Postgres may squat port 5432; the local `prompify-postgres` container has
  been dead since a broken bind mount. Local dev typically points at a separately started Postgres.
- The pre-commit hook has failed historically on `tsc` and prettier. If commits pass suspiciously
  fast, check whether the hook is being bypassed.

---

## 4. Environment variables

`.env.example` is the source of truth for names and the only env file that should ever be tracked.
`.gitignore` has a catch-all `*.env` plus `.dev.vars`/`*.vars`, so a stray `staging.env` or
`prod.env` cannot be committed by `git add -A`.

```bash
cp .env.example .env
```

### Core

```env
NODE_ENV=production
PORT=5173
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/prompify
POSTGRES_DB=prompify
POSTGRES_USER=prompify_user
POSTGRES_PASSWORD=
REDIS_PASSWORD=                # compose requires it even though app code never reads Redis

JWT_SECRET=                    # long random string; fail-closed, no fallback
AUTH_DISABLED=false            # MUST be false in prod
CRON_SECRET=                   # bearer token for /api/cron/*
DATA_API_SECRET=               # signs runtime data-proxy tokens; falls back to JWT_SECRET
```

A password containing `@` works inside `DATABASE_URL` because node-postgres splits at the last `@`.

### AI provider

```env
DASHSCOPE_API_KEY=             # Qwen — the live provider
DASHSCOPE_API_BASE_URL=
DISABLE_DYNAMIC_MODELS=true
DEFAULT_NUM_CTX=
```

Other providers exist in `.env.example` but are unused in prod: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `OPEN_ROUTER_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `DEEPSEEK_API_KEY`,
`PERPLEXITY_API_KEY`, `TOGETHER_API_KEY` / `TOGETHER_API_BASE_URL`, `HYPERBOLIC_API_KEY` /
`HYPERBOLIC_API_BASE_URL`, `LMSTUDIO_API_BASE_URL`, `OLLAMA_API_BASE_URL`,
`OPENAI_LIKE_API_KEY` / `OPENAI_LIKE_API_BASE_URL`, `AWS_BEDROCK_CONFIG`.

### Snapshots and object storage

```env
SNAPSHOTS_ENABLED=true
VITE_SNAPSHOTS_ENABLED=true    # baked in at Docker BUILD time, not runtime
S3_ENDPOINT=
S3_BUCKET=prompify-snapshots
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

`VITE_`-prefixed variables are inlined into the client bundle at build time. **Never put a secret
behind a `VITE_` name** — it ships to every browser. This was a real finding once
(`VITE_AUTH_DISABLED`).

### Email, billing, integrations

```env
RESEND_API_KEY=                # see section 10
FROM_EMAIL=noreply@prompify.com
FROM_NAME=Prompify
EMAIL_VERIFICATION_REQUIRED=true

STRIPE_SECRET_KEY=             # see section 11
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_<TIER>_<MONTHLY|ANNUAL>=

SUPABASE_URL=                  # per-app database provisioning
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # highest-privilege secret in the file — see section 13

KOOGALLERY_ENABLED=
KOOGALLERY_ACCESS_ID=
KOOGALLERY_ACCESS_KEY=         # HMAC-SHA256 marketplace callbacks
KOOGALLERY_API_BASE_URL=https://api.koogallery.com

GITHUB_TOKEN=                  # server-side, for api.github-template
```

### URLs and client flags

```env
APP_URL=https://www.prompify.com     # email links, Stripe redirects, email logo host
SITE_URL=
PROMPIFY_PUBLIC_URL=
VITE_LOG_LEVEL=debug
VITE_HIDE_SETTINGS= / VITE_HIDE_GIT_CLONE= / VITE_HIDE_IMPORT_CHAT= / VITE_HIDE_IMPORT_FOLDER=
VITE_DISABLE_FRAMEWORK= / VITE_DISABLE_DATABASE= / VITE_DISABLE_CSS_FRAMEWORK= / VITE_DISABLE_LANGUAGE=
VITE_GITHUB_ACCESS_TOKEN= / VITE_GITHUB_TOKEN_TYPE=
```

### Dead variables — delete if still set

Verified absent from `.env.example`, read by nothing:

- `SENDGRID_API_KEY` — SendGrid fully removed; transport is Resend.
- `STRIPE_PRICE_TOPUP_1M` — the customer-facing top-up pack was removed. Admins still grant tokens
  manually from the admin console.
- `STRIPE_PUBLISHABLE_KEY` — checkout is a server-side redirect; no client-side Stripe key exists.

`AUTH_DISABLED=true` is a full-access local bypass that also grants superadmin. It is ignored when
`NODE_ENV=production`, and the app logs a warning if set there.

The app service is declared `env_file: '.env'`, so any new variable in that file reaches the
container with no compose edit. **`up -d` recreates a container and picks up env changes;
`restart` does not.** Always verify with `exec app printenv | grep ...`.

---

## 5. Production deploy

```bash
cd ~/prompifyChulaDev
git log --oneline -1                       # note this — it is the rollback commit
sudo docker compose -f docker-compose.prod.yaml --profile production stop app
git fetch origin && git reset --hard origin/feat/persistence-on-euleros
sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
sudo docker compose -f docker-compose.prod.yaml --profile production logs -f app
```

Watch for `listening` and no `relation ... does not exist`. If boot aborts, roll back.

Back up first when a release touches the schema:

```bash
docker exec prompify-postgres pg_dump -U prompify_user -d prompify -Fc -f /tmp/pre-$(date +%F).dump
docker cp prompify-postgres:/tmp/pre-$(date +%F).dump ./
ls -lh pre-*.dump                          # confirm non-zero
```

### Rules

- Every compose command needs `--profile production`.
- **Never remove `postgres_data`. Never `down -v`.**
- Stop **`app` only**. Postgres and Redis stay up.
- Never a bare `up -d` — it starts nginx and certbot too, which can hit Let's Encrypt rate limits.
- `--build` is required. Without it compose reuses the existing `bolt-ai:production` image, because
  the service declares both `image:` and `build:`. This is how a stale runtime survives a "deploy".
- If Docker reports CACHED on the pnpm step when it shouldn't, add `--no-cache`.
- Prod `.env` must have `AUTH_DISABLED=false`. Never copy staging's `.env` over it — staging ran
  with auth disabled and a different database password.
- Changing `JWT_SECRET` logs everyone out.
- Aux services are separate: `up -d cron` and `up -d backup` are untouched by `up -d app`.

### Verify

```bash
sudo docker exec prompify-app node --version    # expect v22.23.4
curl -s http://localhost:5173/api/health
sudo docker exec prompify-postgres psql -U prompify_user -d prompify \
  -c "SELECT to_regclass('codebase_versions'), to_regclass('codebase_blobs'), to_regclass('app_tables');"
```

Any `NULL` from that last query means a partially-migrated database — read section 6.

Then on https://www.prompify.com: log in (nobody should be forced to re-auth), existing chats load,
generation streams, edit a file then save then hard refresh and the edit survives (this exercises
snapshots, OBS and CORS), and version history lists and restores.

### Rollback

```bash
sudo docker compose -f docker-compose.prod.yaml --profile production stop app
git reset --hard <commit from step 1>
sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
```

Data is untouched — the volume is never removed. Restore from a dump only if data looks corrupt.

### TLS certificates

Let's Encrypt via the certbot container, webroot challenge. Current cert was issued 2026-10-18 and
expires **2027-01-16**.

**Known gap (OPS-1).** The certbot renew loop has no `--deploy-hook`, and nginx caches
certificates in memory for the life of the process. Renewal writes a new cert to disk but nothing
signals nginx, so the renewed cert is not served until something reloads it.
`scripts/renew-certbot.sh` renews *and* reloads correctly, but it is manual and unscheduled —
`scripts/setup-cron.sh` only schedules `daily-sync.js`.

Renewal is due around 2026-12-17. The hard failure date, if nothing reloads nginx before then, is
**2027-01-16**. Any nginx restart in between silently masks the problem for another 90 days — which
is why it has not bitten yet, and why "the dates match today" is not evidence that it is fixed.

Check what is served versus what is on disk:

```bash
openssl s_client -connect www.prompify.com:443 -servername www.prompify.com </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -issuer
sudo docker exec prompify-nginx cat /etc/letsencrypt/live/prompify.com/cert.pem \
  | openssl x509 -noout -dates -issuer
```

Differing `notAfter` values mean renewal works but the reload does not. Manual reload:

```bash
sudo docker exec prompify-nginx nginx -t && sudo docker exec prompify-nginx nginx -s reload
```

Two traps in the cert scripts:

- `scripts/renew-certbot.sh` calls `docker-compose` (v1, hyphen) with no `sudo`, which does not
  match this VM. Run `which docker-compose` before scheduling it, or it fails silently from cron.
- `scripts/init-certbot.sh` patches `nginx-ecs.conf`, but compose mounts `nginx-prod.conf`. It
  works only because the domain is hardcoded in the mounted file, and will silently do nothing if
  the domain ever changes.

`ssl_prompifycom/` is still bind-mounted by `docker-compose.prod.yaml:250` but now holds only a
`.gitkeep`. The previously committed cert and private key were removed on 2026-10-26; the key was
already rotated out of use. The `ssl_certificate` lines referencing it in `nginx-prod.conf` are
commented out.

### Backups

Three layers (`scripts/backup-runner.sh`, container `prompify-backup`): WAL archiving to OBS every
60s, `pg_dump` daily, `pg_basebackup` weekly, each with retention. If the backup container dies,
WAL segments accumulate harmlessly on a shared volume without affecting Postgres.

A backup you have never restored is a hypothesis, not a backup — see section 14.

---

## 6. Schema changes — read before adding a column

This is the highest-value operational section in this document. The naive summary — "migrations
are idempotent and run automatically on boot" — **is wrong on prod**, and believing it has already
caused two production outages.

### How it is supposed to work

`schema.sql` is the single source of truth, inlined at build time via a Vite `?raw` import and
applied by `createPostgresTables()` in `app/lib/database-postgresql.ts`. It is applied two ways:

1. the Postgres image runs it on a **fresh volume** (`/docker-entrypoint-initdb.d/schema.sql`);
2. the app runs it on **every startup** via `ensurePostgresReady()`.

Every statement is written to be idempotent: `CREATE TABLE IF NOT EXISTS`,
`INSERT ... ON CONFLICT`, plus 15 explicit `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. A
`schema_migrations` table records one-off migrations, guarded by
`IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '...')`.

### How it actually behaves

Two things break the guarantee:

1. **`createPostgresTables()` aborts partway through on prod.** The documented cause is a
   `project_id` foreign-key migration that fails on orphan chats. Everything *after* the failing
   statement never runs. `ensurePostgresReady()` memoizes the promise and rethrows, so the failure
   is also easy to miss.
2. **Not every database entry point runs migrations at all.** `getPostgresPool()` — used by the
   version-save path, `api.data.*` and `api.import-data` — does **not** call
   `createPostgresTables()`. Only `getPostgresDatabase()` does.

The observed consequences, both real incidents:

- the `change_summary` column was never added, so **every version save 500'd** with
  `column change_summary does not exist`;
- `app_tables` did not exist, so **every data route 500'd** with
  `relation app_tables does not exist`.

### The current workaround

Two lazy, self-contained "ensure" functions run once per process on the *same pool* their caller
uses:

- `ensureCodebaseVersionSchema()` — creates the two codebase tables, the `change_summary` and
  `message_id` columns, and the indexes.
- `ensureAppTablesSchema()` — creates the `app_tables` registry plus its indexes and the
  `category` / `workspace_type` / `workspace_id` columns.

Both are `IF NOT EXISTS` throughout and log-and-retry on failure.

### What this means for you

- **Adding a column late in `schema.sql` is not enough.** On an existing prod database it may never
  be applied, because the function can abort before reaching it. Add an explicit
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and if the column is read by a path that uses
  `getPostgresPool()`, add it to that path's `ensure...Schema()` too.
- **After any schema release, verify on prod** with the `to_regclass` query in section 5 and a
  direct `\d <table>` on the changed table. Do not trust a clean boot log.
- **The real fix is to make `createPostgresTables()` complete.** Clean up the orphan chats, or make
  the FK migration tolerant, so the function runs to the end. Until then every new column carries
  this hazard and the ensure-function workaround keeps growing. This is the top item in section 15.

`archive/PROMPIFY-INTERNAL-DOCS.md` section 5 covers the same hazard from the original author's
perspective.

---

## 7. Architecture

```
User (browser)
    |-- Structured prompt wizard (6 questions -> system prompt)
    |-- AI IDE - WebContainer (Node via WASM)
    |     |-- CodeMirror 6 editor
    |     |-- xterm.js terminal
    |     \-- live preview (iframe)
    \-- Deploy -> Netlify, code pushed to a GitHub repo
                   \-- app appears in /c/{company-slug}
```

```
nginx (443/80)
  \-- app (Remix, 127.0.0.1:5173)
        |-- postgres (15)
        |-- redis (7, unused)
        \-- cron -> /api/cron/* on a schedule
```

The request lifecycle, snapshot save/restore path, rewind flow and the full prompt-to-files flow
are documented in `archive/PROMPIFY-INTERNAL-DOCS.md` sections 3 and 4, and
`archive/ARCHITECTURE-v2.md` Parts 3 to 6. Read those before changing persistence.

### Snapshots (content-addressed)

Three-tier restore in `app/lib/snapshots/loadSnapshot.ts`: IndexedDB cache, then server manifest
plus blob download, then message replay. Saves are debounced 1s in `scheduleSnapshot.ts`, with a
`pagehide`/`visibilitychange` flush and a session-token stale-cache bypass so a cache from a
previous page session is not trusted.

Streaming persistence is throttled. `storeMessageHistory` used to `JSON.stringify` the entire
message array roughly 20 times a second during streaming, which froze the page. It now writes every
2s while loading, and always at turn end.

### Cross-origin isolation (fragile, easy to break)

WebContainer needs `crossOriginIsolated === true`, which requires COOP/COEP on **every** response.
`server.js` sets `Cross-Origin-Embedder-Policy: require-corp`,
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: cross-origin` on all
responses; `entry.server.tsx` also sets them on documents (same values, so the later `setHeader` is
a harmless overwrite).

**Do not add these headers in nginx.** `add_header` *appends*, producing duplicates, and browsers
treat a duplicated COOP/COEP as invalid → the policy falls back to `unsafe-none` →
`crossOriginIsolated === false` → WebContainer and `SharedArrayBuffer` die behind the proxy. The
comments in `nginx-prod.conf` say this; they are load-bearing.

The same file carves `/api/data/` out of the `location /` block for an analogous reason: the app is
the sole CORS authority there, and the blanket `Access-Control-Allow-Origin *` would produce two
`Access-Control-Allow-Origin` values, which browsers reject.

### Mobile

WebContainer cannot run on mobile — it needs `SharedArrayBuffer` and cross-origin isolation, and
StackBlitz does not support mobile browsers (iOS Safari in particular). This is a hard platform
limit, not a CSS problem.

| Works on a phone | Cannot work, ever |
|---|---|
| Landing, signup, pricing, billing | Workbench: editor, terminal, preview |
| Chatting with the AI | Anything WebContainer-backed |
| Viewing a deployed preview link | |

The interstitial is built (`WorkbenchUnavailable.tsx`, gated at `useViewport(640)`). Do not invest
in making the workbench responsive; keep the landing, auth and billing funnel solid instead — that
is the acquisition path, and people click marketing links on phones constantly.

---

## 8. Data model

Two concerns share one Postgres instance: **platform data** (users, chats, projects, billing) and
**runtime app data** (the tables generated apps read and write).

### Platform tables

All 31 tables defined in `schema.sql`:

| Area | Tables |
|---|---|
| Identity | `users`, `user_sessions`, `user_activity` |
| Projects & chats | `projects`, `project_members`, `chats`, `chat_members`, `chat_invitations`, `prompts` |
| Companies | `companies`, `company_members`, `company_invitations`, `company_invite_codes`, `audit_logs` |
| Billing | `subscriptions`, `subscription_tiers`, `payments`, `token_usage`, `token_balances`, `token_consumption_allocations` |
| Persistence | `codebase_versions`, `codebase_blobs` |
| Runtime data | `app_tables`, `workspace_brand_context` |
| Deployment | `app_deployments` |
| Marketplace | `koogallery_instances`, `koogallery_logs` |
| Ops | `email_logs`, `rate_limits`, `contact_submissions`, `schema_migrations` |

Phase-2 `projects` columns: `company_id`, `status` (`draft|building|active|sleeping|failed`),
`runtime_type` (`static|worker|container`), `github_repo`, `deploy_url`, `last_active_at`,
`build_logs`.

### Runtime app data — isolation

Schema-per-workspace, not per-app:

- **Personal** tables live in `usr_<userId>` — owner only.
- **Company** tables live in `cmp_<companyId>` — all company members read and write.
- Each table gets a chat-scoped physical name via `physicalNameFor(tableName, chatId)`, so two
  projects using the same logical name never collide.
- `app_tables` tags each row with `workspace_type` (`personal|company`), `workspace_id`,
  `category` (`master|transactional`), and a `columns` JSONB carrying soft FK `references`.
- A project's workspace is **fixed at creation** — copy to move, never migrate.

Isolation layers, strongest first:

1. schema namespace (`usr_` / `cmp_`)
2. server-side checks — `getChatById` for chat access, `getCompanyMember` for company membership
3. registry scoping — `getRegisteredTable(chatId, logicalName)` requires the table to belong to
   this chat
4. `SET LOCAL statement_timeout = 5s` plus row caps on the proxy

`runAppQueryInSchema` is the migratability hook: a different backend (Neon, RLS, multi-DB) can be
swapped in behind it without touching callers. At current scale (~150 schemas) the per-schema model
has years of headroom; `data/DBProposal.md` evaluates twelve alternatives and recommends Neon
per-project if scale ever demands it.

### Master vs transactional

`app_tables.category` is `master` (reference data such as users or products) or `transactional`
(events and records such as orders or messages). Master data may be personal or company-shared.
Only company admins can create master tables in a company workspace. The Data panel groups tables
into Master / Transactional / Uncategorized.

### Foreign keys

Soft FKs are shipped: `columns[].references = { table, column }` in the columns JSONB, with the
Data panel rendering a parent-row dropdown in the add/edit modal. Strict database `FOREIGN KEY`
constraints and FK-aware seeding are deferred — see section 15.

---

## 9. API reference

68 route modules under `app/routes/api.*`. Grouped below; names map to files as
`api.<name>.ts`.

### Auth — public by design, rate-limited
`auth.login` · `auth.register` · `auth.logout` · `auth.verify` · `auth.forgot-password` ·
`auth.reset-password` · `auth.change-password`

### AI, generation, deployment
| Route | Notes |
|---|---|
| `chat`, `chat.$id` | streams generation (SSE); `requireAuth` |
| `llmcall` | direct LLM call; `requireAuth` |
| `enhancer` | prompt enhancement; `requireAuth` |
| `review` | `requireAuth` |
| `generate-context`, `workspace-context` | brand/workspace context extraction — the user-supplied-URL fetch path guarded by `safe-fetch.server.ts` |
| `models`, `models.$provider` | provider/model listing |
| `deploy` | Netlify deploy; `requireAuth` |
| `github.push` | **orphaned — zero call sites**; the live push runs in the browser |
| `github-template` | uses the server `GITHUB_TOKEN` |
| `git-proxy.$` | `requireAuth`; host allowlist + private-IP blocklist; strips `cookie`/`authorization` upstream |
| `update` | **superadmin-only shell-out — see section 12** |

### Runtime data proxy
`data.$chatId.$resource` (GET/POST/PATCH/DELETE) · `data.$chatId.$resource.seed` ·
`data.$chatId.$resource.generate` · `data.$chatId.schema` · `data.token` · `import-data`

### Snapshots and versions
`snapshots.upload-url` · `snapshots.dedup` · `chats.$id.version` · `chats.$id.version.$n` ·
`chats.$id.version.latest` · `chats.$id.versions` · `chats.$id.rollback`

### Chats, sharing, companies
`chats` · `chats.$id.members` · `chats.$id.invite` · `chats.$id.invitations` ·
`chats.$id.prompts` · `invitations` · `invitations.$id.accept` · `companies` ·
`companies.$id.members` · `companies.$id.invite` · `companies.$id.invite-code` ·
`companies.$id.leave` · `companies.join`

### App lifecycle and cron
`apps.$id.wake` · `apps.$id.sleep` · `cron.sleep-check` · `cron.gc` · `cron.inactivity`

Cron routes require `Authorization: Bearer $CRON_SECRET`, compared with
`crypto.timingSafeEqual`.

### Billing
`billing.checkout` · `billing.portal` · `billing.webhook` (HMAC signature verified)

### Supabase provisioning
`supabase.config` · `supabase.schema`

### Marketplace (Huawei KooGallery)
`koogallery.create-instance` · `koogallery.query-instance` · `koogallery.update-instance` ·
`koogallery.update-instance-status` · `koogallery.upgrade-instance` ·
`koogallery.release-instance`

HMAC-SHA256 signed, timing-safe compare. Nginx also exposes `/saasproduce` as the SaaS 2.0
endpoint. Nonce replay protection is still open (M-3).

### Ops
`health` · `metrics` · `contact` (public, sanitized and length-capped) · `admin.users`

### Pages
`_index` · `about` · `app`, `app._index`, `app.overview`, `app.pricing`, `app.settings`,
`app.admin`, `app.data`, `app.workspace` · `auth.*` · `c.$slug._index`, `c.$slug.settings` ·
`company.new` · `chat.$id` · `projects.$projectId.chats.$id` · `git` · `invite.accept` ·
`join.$code` · `webcontainer.preview.$id` · `saasproduce` · `robots.txt` · `sitemap.xml` ·
`env-config.js`

**There is no global auth middleware.** Authorization is per-route. Every new route must opt in
explicitly — see section 13.

---

## 10. Email — Resend

Email is **built**; what follows is configuration. `app/lib/email.ts` is a dependency-free Resend
client — there is no `resend` package to install. SendGrid has been removed entirely.

| Template | Fires when |
|---|---|
| Verification | account registered |
| Welcome | verification link clicked |
| Password reset | reset requested |
| Invitation | someone invited to a project |
| Inactivity nudge | 30 days idle, again at 60 |

Email stays inert until `RESEND_API_KEY` is set — every template logs to the console instead of
sending. Nothing breaks; people simply never receive mail.

### Setup

1. resend.com, then **Domains → Add Domain → `prompify.com`**. Add the printed MX and two TXT
   records (SPF, DKIM) at the DNS host, then **Verify**. Until it reads *Verified*, every send from
   `noreply@prompify.com` is refused with a 403. Start here, not last — propagation can take hours.
2. Do **not** work around a pending domain with Resend's shared `onboarding@resend.dev`. It only
   delivers to your own account address, so it looks like it works for you and silently fails for
   every real customer.
3. **API Keys → Create API Key**, permission *Sending access*. The `re_...` value is shown once.
4. Test the credentials before touching the app:
   ```bash
   RESEND_API_KEY=re_... FROM_EMAIL=noreply@prompify.com ./scripts/test-resend.sh you@example.com
   ```
   The app fails soft on email — a refused send is logged and the request carries on — so a bad key
   is otherwise invisible until someone reports never getting a verification link. A 401 or 403 here
   means the key is wrong or the domain is not verified.
5. Walk the signup path and assert against `email_logs`, not the Resend UI:
   ```sql
   SELECT email_type, delivered, error_message, sent_at
   FROM email_logs WHERE user_id = '<userId>' ORDER BY sent_at;
   ```
   Expect `verification / true`, then a second row `welcome / true` after clicking the link.
   `delivered = false` carries Resend's reason. Re-clicking a used link must **not** produce a
   second welcome row.
6. Go live: back up `.env` first (`cp .env .env.bak.$(date +%F)`), add the three variables, delete
   `SENDGRID_API_KEY`, deploy per section 5, then recreate **both** `app` and `cron` — the cron
   service carries the nightly schedule and `up -d app` does not touch it. Confirm:
   ```bash
   sudo docker compose -f docker-compose.prod.yaml --profile production exec app printenv | grep -E 'RESEND|FROM_'
   ```

### Deliverability

A brand-new sending domain has no reputation, so early mail lands in spam more often. Two existing
design choices protect it and should be left alone: the welcome mail is sent *after* verification,
so only confirmed addresses are ever mailed; and the inactivity job only selects
`is_verified = TRUE` and stops after two nudges. Add DMARC once DKIM and SPF verify.

### Inactivity nudges

The cron container calls the endpoint nightly at about 04:45 UTC and runs **dry-run by default** —
it mails real customers, so sending is an explicit choice.

```bash
curl -s -X POST http://localhost:5173/api/cron/inactivity \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

`due` is how many people would be mailed on the first run — and the first run is the entire
backlog, not the daily trickle. Hundreds at once on a domain verified last week is exactly how a
domain gets marked as a spam source. Cross-check before switching it on:

```sql
SELECT COUNT(*) FROM users
WHERE is_verified = TRUE
  AND COALESCE(last_login, created_at) < NOW() - INTERVAL '30 days';
```

Ramp with `?apply=true&limit=50` for a few days, watching bounce and complaint rates, before
letting the nightly job send unlimited. `more: true` means the batch saturated and a backlog
remains. To go live, add `?apply=true` to the inactivity line in `docker-compose.prod.yaml` and
recreate `cron`.

Thresholds are constants in `app/lib/engagement/inactivity.server.ts`: `INACTIVITY_DAYS` (30, with
the second nudge a further 30 days later) and `MAX_INACTIVITY_NUDGES` (2). Signing in resets the
clock. Raising the cap mails dormant mailboxes indefinitely — it exists on purpose.

**Kill switch:** empty `RESEND_API_KEY` and recreate. All sending stops immediately, every template
falls back to logging, no code change and no broken request paths.

---

## 11. Billing — Stripe

Billing is **built**. `app/lib/billing/stripe.server.ts` is a dependency-free Stripe client — no
`stripe` package. It covers checkout, the billing portal, webhook signature verification,
company-scoped subscriptions and token grants. Tiers are seeded in `schema.sql` with ids matching
`app/lib/billing/plans.ts`.

Billing stays inert until `STRIPE_SECRET_KEY` is set — `/api/billing/checkout` returns 503 and the
pricing page says billing is not configured.

### Naming

`STRIPE_PRICE_PRO_MONTHLY` from the business side is `STRIPE_PRICE_BUILDER_MONTHLY` in code — same
plan. Builder is the $8/mo tier, and six other tiers already follow
`STRIPE_PRICE_<TIER>_<INTERVAL>`, so the variable is renamed rather than the code.

### Tier map

| Stripe product | tierId | Monthly var | Annual var | `plans.ts` |
|---|---|---|---|---|
| Builder | `tier_builder` | `STRIPE_PRICE_BUILDER_MONTHLY` | `..._ANNUAL` | $8 / $72 |
| Innovator | `tier_innovator` | `STRIPE_PRICE_INNOVATOR_MONTHLY` | `..._ANNUAL` | $19 / $192 |
| Team | `tier_team` | `STRIPE_PRICE_TEAM_MONTHLY` | `..._ANNUAL` | $129 / $1,260 |
| Business | `tier_business` | `STRIPE_PRICE_BUSINESS_MONTHLY` | `..._ANNUAL` | $349 / $3,480 |
| Scale | `tier_scale` | `STRIPE_PRICE_SCALE_MONTHLY` | `..._ANNUAL` | $749 / $7,500 |

`tier_trial` (free) has no Stripe price and must never get one — it is the 3-prompt trial granted
in-app at signup and is never rendered as a purchasable card.

Annual totals are **not** a clean multiple of monthly. They are `priceAnnualPerMonthCents × 12`,
using the printable headline per-month figure ($6, $16, $105, $290, $625) rather than the $6.67 a
10× annual total would produce. **The Stripe annual price must equal the total in this table.**
`plans.spec.ts` only enforces that the card's own two numbers agree with each other; nothing can
check them against Stripe, so a divergence means the page advertises one figure and the card is
debited another.

Every tier resolves its price id from an env var at request time (`resolvePriceId`,
`stripe.server.ts:163`), so enabling a plan means setting its variable and recreating the
container — no code change. A tier with no price id cannot be purchased and the pricing page hides
it.

### Two properties that decide whether a price id works at all

- **Mode.** Price ids are scoped to test or live mode. A `sk_live_` key with a test-mode `price_`
  id fails at checkout with a raw Stripe API error, not a graceful message. The id itself does not
  say which mode it belongs to — confirm with whoever sent it.
- **Interval.** A price is created as monthly *or* yearly recurring; the same id cannot serve both.
  `_MONTHLY` and `_ANNUAL` must come from two different Stripe prices on the same product.

### Test mode first

1. Test mode, product **Builder**, recurring $8/month, copy the price id.
2. Set `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_PRICE_BUILDER_MONTHLY=price_...`,
   `APP_URL=http://localhost:5173`.
3. `stripe listen --forward-to localhost:5173/api/billing/webhook`, then put the printed
   `whsec_...` into `STRIPE_WEBHOOK_SECRET` and restart. **This secret differs between test and
   live mode** — swapping keys later without swapping it fails every webhook on signature.
4. Buy with card `4242 4242 4242 4242`, any future expiry, any CVC.
5. Assert against the database, not the Stripe UI:
   ```sql
   SELECT company_id, tier_id, status, stripe_subscription_id
   FROM subscriptions WHERE company_id = 'cmp_personal_<userId>';
   -- expect tier_builder / active / sub_...

   SELECT source, tokens_allocated, tokens_used, effective_end
   FROM token_balances WHERE company_id = 'cmp_personal_<userId>' ORDER BY created_at DESC;
   -- expect a 'tier' row of 1000000 tokens
   ```
   The `stripe listen` terminal should show `checkout.session.completed` and `invoice.paid` both
   returning 200. A 400 is almost always a stale `STRIPE_WEBHOOK_SECRET`.
6. Cancel in the dashboard — `customer.subscription.deleted` should drop the account to
   `tier_trial` and expire the tier balance. Historical top-up balances survive by design.
7. `/api/billing/portal` should open Stripe's hosted portal.

### Go live

1. Recreate the product and price in **live mode**; copy the live `price_...`.
2. Developers → Webhooks → **Add endpoint** `https://www.prompify.com/api/billing/webhook`, events
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Its signing secret is the
   **live** `STRIPE_WEBHOOK_SECRET` — not the one `stripe listen` printed.
3. Add the live keys to prod `.env`, backing it up first. No compose edit is needed.
4. Recreate the app container, then confirm it actually sees them:
   ```bash
   docker compose -f docker-compose.prod.yaml exec app printenv | grep STRIPE_PRICE | sort
   ```
   Expect ten lines with non-empty `price_` values.
5. Do exactly one real $8 Builder purchase, run the step-5 queries against prod, then refund it.
6. Confirm all deliveries show 200 under Developers → Webhooks.

**Set both intervals per tier, or neither.** The pricing page shows a plan when *either* interval
resolves, but the Annual toggle then sends `interval: 'year'` to checkout, which returns 400
*"No Stripe price configured for X (year)"*. A monthly-only tier is a visible dead end.

Refunding does **not** revoke granted tokens. That is deliberate, but a test purchase on a big tier
hands out real allocation — test on Builder only.

On the pricing page, the **User** toggle shows Builder, Innovator and Team; **Enterprise** shows
Business and Scale. The free trial appears on neither.

### Troubleshooting

| Symptom | Cause |
|---|---|
| Checkout returns 503 | `STRIPE_SECRET_KEY` not set in the running container |
| "Plan is not available" | that tier's `STRIPE_PRICE_*` is empty, or holds a test id in live mode |
| Webhook 400 | `STRIPE_WEBHOOK_SECRET` does not match the endpoint sending the event |
| Payment succeeds, no tokens | webhook never arrived — check public reachability and 200s |
| Tokens granted twice | should not happen; grants are idempotent on the Stripe invoice id |
| "No such price" | test-mode price id with a live secret key, or vice versa |
| Tier right, grant wrong | `plans.ts` and the `subscription_tiers` seed disagree; grants read `plans.ts` |
| Tier missing from pricing page | neither price var resolved — re-run the `printenv` check |
| "No price configured for X (year)" | `_MONTHLY` set, `_ANNUAL` empty |

Rollback: restore `.env.bak.<date>` and recreate the app container. Emptying a `STRIPE_PRICE_*`
removes that plan from the pricing page without affecting anyone already subscribed — existing
subscriptions keep renewing and keep granting tokens, because `invoice.paid` falls back to the
subscription's `tierId` metadata when the price id no longer maps.

---

## 12. Security status

Two audits inform this section: a forensic audit on 2026-06-26 with remediation on 2026-07-17
(`archive/SECURITY_NOW.md`), and a read-only audit on 2026-10-26 prompted by the October 2026
"Black October" disclosures.

### Posture

- **AuthN** — JWT in an `HttpOnly; SameSite=Strict; Secure` cookie, server-side session table keyed
  by `sha256(token)`, bcrypt password hashes. Fail-closed: no secret, no boot.
- **AuthZ** — per-route `requireAuth` / `requireSuperadmin` plus ownership SQL. **No global
  middleware.**
- **Rate limiting** — Postgres-backed (`checkRateLimitPostgres`), not an in-process Map.
- **Crypto** — AES-GCM; `crypto.timingSafeEqual` for secret comparisons.
- **SSRF** — two guards: `app/lib/safe-fetch.server.ts` (`assertPublicHttpUrl`: blocklist, redirect
  re-validation, size and time bounds) for user-supplied URLs, and a host allowlist in
  `api.git-proxy.$.ts`. Both are sound. Neither defeats DNS rebinding.

### October 2026 exposure review

| Incident | Applies? |
|---|---|
| PHP2Shell (CVE-2026-109618/109619) | **No** — no PHP runtime. Shiki ships PHP/Blade grammars for syntax highlighting only |
| LiteLLM 1.107.0 supply chain | **No** — no Python dependencies, no `litellm` anywhere |
| GitLab CVSS 10.0 (CVE-2026-110264) | **No** — GitHub-hosted; self-managed only |
| Railway / Zeabur breaches | **No** — Netlify, own VM, Huawei OBS |
| Node2Shell Brotli RCE (CVE-2026-111497) | **Closed** — prod verified on v22.23.4, a fixed version |
| eMudhra CA key compromise (CVE-2026-111943) | **Indirect** — rebuild anything Go-based on Go 1.26.10+ |

Node2Shell deserves a note. `fetchTextLimited` fetches user-supplied URLs with
`redirect: 'follow'`, which is exactly the documented attack surface (a hostile server replying
`Content-Encoding: br`). The SSRF guard checks *where* you fetch, not *what* comes back, so the
runtime version is the only thing between that path and the bug. Keep the runtime patched.

### `api.update.ts` — correction to the old audit

`archive/SECURITY_NOW.md` records CRIT-3 as "route deleted". **It was not deleted.**
`app/routes/api.update.ts` is 592 lines, still routed, and still shells out to git and pnpm via
`child_process.exec`. It was *hardened*:

- `requireSuperadmin(request, context)` on entry, which 404s a non-superadmin;
- a `SAFE_BRANCH` regex (`/^[A-Za-z0-9._\/-]{1,255}$/`) on the branch name before it is
  interpolated into shell commands.

That is a reasonable guard, and the in-file comments are honest about the history. But it remains
remote command execution by design inside the production container, inherited from bolt.diy, whose
purpose is self-updating from `stackblitz-labs/bolt.diy` upstream — something Prompify never does.
**The recommendation is to delete the route**, not to guard it better. It is residual risk with no
product value, and it is one superadmin credential away from being an RCE.

### Open findings

| ID | Finding | Severity |
|---|---|---|
| DB-1 | `createPostgresTables()` aborts partway on prod; two paths need lazy ensure-functions to compensate. Every new column carries a silent "does not exist" risk | **High** |
| CI-1 | Shell injection in `.github/workflows/update-stable.yml` — `${{ github.event.head_commit.message }}` interpolated into bash with `contents: write` | High |
| CI-2 | Unpinned `pip install mkdocs-material` in `docs.yaml` with `contents: write` | High |
| CI-3 | CI uses EOL Node 20 in `update-stable.yml` | High |
| CI-4 | Actions pinned to mutable tags. `semantic-pr.yaml` pins a full SHA and is the pattern to copy | Medium |
| OPS-1 | Certbot renews but nothing reloads nginx. Deadline 2027-01-16 | High |
| SEC-0 | `api.update.ts` — superadmin-only RCE by design; delete it | Medium |
| SEC-1 | `scripts/daily-sync.js` sets `ssl: { rejectUnauthorized: false }` on both Postgres pools, nightly, over `users` and `user_sessions` | Medium |
| SEC-2 | `app/lib/fetch.ts` sets `rejectUnauthorized: false` — gated to `import.meta.env.DEV` and imported nowhere. Dead code, but delete it | Low |
| SEC-3 | Wildcard `Access-Control-Allow-Origin: *` on `location /` and in `api.git-proxy` | Medium |
| SEC-4 | `nginx-prod.conf` cipher list contains non-existent suites (`ECDHE-RSA-AES256-GCM-SHA512`); nginx silently ignores unknown names, so the effective list is narrower than written | Low |
| SEC-5 | `auth_file.txt` — committed Huawei Marketplace ownership token. May still be served for verification; confirm before removing | Low |
| SEC-6 | Secrets in git history — a TLS private key and two database passwords. **All rotated and inert**; history purge still pending | Medium |
| H-1 | Company IDOR — any authed user can edit any company. Deferred; company features not live. Only the POST branch was re-verified in October | High |
| M-3 | KooGallery nonce replay. Timing-safe compare done; nonce tracking deferred | Medium |
| L-4 | Snapshot dedup is an existence oracle | Low |
| — | No CSRF tokens on state-changing routes; `SameSite=Strict` is the only defense. Verified still absent | Medium |

### Closed since the last audit

- **Node2Shell** — prod runs v22.23.4, verified by `docker exec prompify-app node --version`.
- **The committed TLS private key** — removed from the index and from disk on 2026-10-26. The live
  certificate uses a different key, confirmed by comparing public-key fingerprints against what the
  server actually serves. The old DigiCert cert expired 2026-01-04, so there is nothing to revoke.
  `.gitignore` now has `ssl_prompifycom/*.pem`.
- **The Postgres password published in `README.md`** — the README section is gone and the password
  was rotated. It remains in 23 historical commits and in `docker-compose.dev.yaml`, but is inert.

The 2026-07-17 pass fixed: the `'your-secret-key'` JWT fallback (now fail-closed), seven debug
endpoints leaking env and identity (deleted), unauthenticated paid LLM and deploy endpoints,
Supabase DDL injection, cross-tenant schema access, the `AUTH_DISABLED` mock-admin, an ineffective
in-process rate limit, AES-CBC without a MAC, unhashed reset tokens, and email-existence disclosure
on register.

`archive/SECURITY_NOW.md` Appendix A is stale on **two** points: it lists `api.git-proxy.$.ts` as
having no auth (it now calls `requireAuth` on both `action` and `loader`), and it claims
`api.update.ts` was removed (it was not).

---

## 13. Keep in mind — security

Forward-looking. None of this is on fire; all of it is the kind of thing that becomes a finding if
nobody writes it down.

### Authorization has no safety net

There is no global middleware. A new route with no `requireAuth` is simply public, and nothing in
CI or review catches it. Two consequences worth internalizing:

- **A `withAuth` wrapper is the single highest-leverage security investment in this codebase.** It
  converts "every author must remember" into "opt out deliberately". It has been a deferred P2 item
  since June.
- Until then, treat *adding a route* as a security-relevant change and state its auth posture in
  the PR description. Appendix A in `archive/SECURITY_NOW.md` is the per-route table to keep
  updated.

### CSRF

State-changing routes rely entirely on `SameSite=Strict`. That is genuinely good coverage for
modern browsers, but it is one mechanism, not two, and it breaks down if a cookie is ever relaxed
to `Lax` for a cross-site redirect flow (OAuth, a GitHub App installation callback). **If the
GitHub App work in section 15 proceeds, revisit CSRF at the same time** — that is precisely the
change that would weaken the only defense.

### Supply chain

October 2026 was a supply-chain month, and the lessons map directly onto this repo:

- **Pin by digest, not by tag.** `actions/checkout@v4` is mutable; `semantic-pr.yaml` already pins
  a full SHA and is the model. Same for `pip install` and any base image.
- **A write-capable `GITHUB_TOKEN` plus an unpinned install is the GhostAction pattern.** Audit
  workflow permissions down to least privilege; most jobs need `contents: read`.
- **Secrets in CI are the prize, not the code.** Rotate anything a workflow has touched if a
  runner is ever suspect.
- Consider `pnpm audit` in CI, and Dependabot or Renovate for lockfile hygiene. Two lockfiles
  existed until 2026-10-26; keep it at one.

### Runtime and trust-store cadence

- **Do not let a runtime go EOL again.** Node 20 was EOL and unpatchable when Node2Shell landed;
  the 2026-10-23 bump to 22.23.4 is what closed it. Node 22 is LTS with maintenance into 2027 —
  diary the EOL date and move before it, not after a CVE forces it.
- **eMudhra's lesson is that trust stores are code, not config.** Anything carrying its own CA
  bundle — Go binaries, Python `certifi`, Node's bundled roots, container base images — needs a
  *rebuild* to distrust a compromised intermediate. A config change cannot do it. When a CA is
  distrusted, the question is "what do we ship that embeds a root store?", and the answer includes
  every Go-based tool in the deploy path.
- The same applies in reverse: `rejectUnauthorized: false` (SEC-1) makes every CA compromise
  irrelevant, because verification is already off. Fix those before the next CA incident, not
  during it.

### Secrets

- **Rotation is two steps for Postgres, not one.** Changing `POSTGRES_PASSWORD` in `.env` does
  nothing to an existing volume — that variable is only read on first initialization. Rotation is
  `ALTER USER prompify_user WITH PASSWORD '...'` inside the running container, *then* `.env`
  (`POSTGRES_PASSWORD` **and** `DATABASE_URL`), then `up -d app`. Never `down -v`.
- **`SUPABASE_SERVICE_ROLE_KEY` is the highest-privilege secret in the file** — it bypasses RLS
  entirely. It belongs in prod `.env` only, should never reach a client bundle, and is the first
  thing to rotate if the VM is ever suspect.
- **Never put a secret behind a `VITE_` name.** Those are inlined into the browser bundle at build
  time.
- **A pre-commit secret scanner would have caught the README password.** `gitleaks` or
  `detect-secrets` in the existing Husky hook is a small change that closes a whole class of
  mistake — and this repo has made that mistake twice.
- The history purge (SEC-6) is now hygiene rather than an emergency, but it needs doing before the
  repo is ever made public or shared more widely. Treat "make this repo public" as blocked on it.

### Multi-tenancy

The four isolation layers in section 8 are genuinely well built, but they are *application*
isolation, not database isolation. Everything lives in one Postgres role. If a tenant ever
demands real separation — or a compliance review asks — the answer is `runAppQueryInSchema`, which
is the seam a Neon-per-project or RLS backend drops into. Decide deliberately rather than
discovering the limit under pressure. `data/DBProposal.md` has the analysis.

Also still open: the data proxy's guards do not stop a *generated app* from being written to abuse
its own tenant's data; isolation is between tenants, not between an app and its owner.

---

## 14. Keep in mind — deployment

### The server migration

A move is expected. Things that travel badly:

- **Fix OPS-1 in `docker-compose.prod.yaml` before migrating, not after.** The compose file is what
  gets deployed to the new host, so an unfixed cert-reload gap is rebuilt there with a fresh 90-day
  clock and nobody watching it.
- **Issue fresh certificates on the new host.** Do not copy `ssl_prompifycom/` across — that is the
  directory whose private key was public in git. It now holds only a `.gitkeep`, which exists
  solely because compose bind-mounts the path.
- **Path assumptions are wrong in two scripts already.** `scripts/setup-cron.sh` hardcodes
  `/opt/prompify` while the repo lives at `/root/prompifyChulaDev`; `scripts/renew-certbot.sh`
  calls `docker-compose` (v1) where this host uses `docker compose` (v2). Both will be wrong again
  on a new host unless parameterized.
- **`.env` is not in git, by design.** It is the one artifact that must be moved by hand, and the
  only copy of several live secrets. Copy it first, verify with `printenv` in the new container,
  and treat the migration as the moment to rotate anything stale.
- **`DATABASE_URL`, `APP_URL`, `SITE_URL` and `PROMPIFY_PUBLIC_URL`** all encode the current host
  or domain. Grep for the IP `159.138.244.247` before cutover.
- **The migration is the natural time to move `nginx-*.conf` and `docker-compose*.yaml` into a
  `deploy/` directory.** It is deliberately *not* done now: compose and the deploy runbook
  reference them by root-relative path, so moving them mid-flight breaks production for no benefit.
  Do it as part of standing up the new host, where the paths are being rewritten anyway.

### Deploy mechanics worth not relearning

- **`--build` is not optional.** The `app` service declares both `image:` and `build:`, so compose
  silently reuses the existing image without it. A "deploy" that changes nothing is the symptom.
- **`up -d` recreates; `restart` does not.** Env changes need the former. Verify with `printenv`
  rather than assuming.
- **`--profile production` on every command.** Omitting it appears to succeed while touching
  nothing.
- **A bare `up -d` starts nginx and certbot**, which can burn Let's Encrypt rate limits. Always
  name the service.
- **There is no zero-downtime path today.** `stop app` → `up -d --build app` is a visible outage for
  the length of a Docker build, and the build is where failures surface. If uptime starts mattering,
  build the image first (or in CI), then swap — rather than building in the deploy window.

### Things that are not monitored

This is the gap most likely to produce the next incident.

- **Certificate expiry.** OPS-1 would have been caught instantly by an external expiry check. One
  is worth more than the reload fix itself, because it catches the whole class, including a future
  mechanism that breaks differently.
- **Backup restores.** Three backup layers exist and none has a documented restore drill. Restore
  the latest dump into a throwaway database and count rows — quarterly is enough. Until that has
  been done once, recoverability is an assumption.
- **Boot-time schema failures.** `createPostgresTables()` failing partway is invisible in a healthy
  log. The `to_regclass` check in section 5 should be part of every deploy, ideally asserted by
  `/api/health` rather than run by hand.
- **Disk.** WAL archiving, `build/` output and Docker images all grow. `build/` alone was 38 MB
  locally; images accumulate per deploy. `docker image prune` is not scheduled anywhere.
- The app has `/api/metrics` and `/api/health`, but nothing described here consumes them.

### Image and dependency pinning

`nginx:alpine`, `certbot/certbot:latest`, `redis:7-alpine`, `postgres:15-alpine` and
`curlimages/curl:latest` are all floating tags. This cuts both ways: floating picks up security
rebuilds automatically (which is what you want for the eMudhra class of fix), but makes builds
irreproducible and lets an upstream change break a deploy with no code change. The defensible
middle is to pin a digest and rebuild deliberately on a schedule. If you keep `latest`, know that a
rollback of *your* code does not roll back *their* image.

### Redis

`prompify-redis` runs, has a required password, and is referenced nowhere in `app/` or `server.js`.
Either wire sessions to it or drop the service — a running, unused, network-attached datastore is
cost and attack surface for zero benefit. Removing it means dropping the service block and
`REDIS_PASSWORD`.

---

## 15. Open work

### Ordered

1. **DB-1 — make `createPostgresTables()` complete.** Clean up the orphan chats or make the
   `project_id` FK migration tolerant. Until this is fixed, every schema change risks a silent
   "column/relation does not exist" in production and the ensure-function workaround keeps growing.
   See section 6.
2. **OPS-1 — certbot reload gap.** The only item with a hard date (**2027-01-16**). Either schedule
   `scripts/renew-certbot.sh` from host cron, or give the nginx service a self-reload loop:
   ```yaml
   command: /bin/sh -c "while :; do sleep 6h & wait $${!}; nginx -s reload; done & nginx -g 'daemon off;'"
   ```
   Avoid a certbot `--deploy-hook` that needs `/var/run/docker.sock` — that is root-equivalent on
   the host and trades a cert-freshness bug for a container-escape primitive. Fix it in compose
   even if the operational work waits for the new server.
3. **CI-1 and CI-2.** Both small, both on paths matching incidents that actually happened in
   October 2026. Pass the commit message via `env:` instead of interpolating it; pin
   `mkdocs-material`.
4. **CI-3.** Bump CI off EOL Node 20.
5. **SEC-0.** Delete `api.update.ts`.
6. **SEC-1.** Give `daily-sync.js` a real CA instead of disabling verification.
7. **An external certificate-expiry alert**, and one backup restore drill.
8. **SEC-6.** Purge git history. Blocking only on making the repo public.

### Product backlog

- **W3** — share personal into company (per-table copy). `LinkExistingTableModal` exists but only
  links within the user's own chats, not into a company workspace.
- **W4** — data-overview page: a cross-project, cross-workspace browser with workspace and category
  columns.
- **W5** — master-data reuse: inject the company workspace's master tables into
  `getSchemaContext`, with a prompt rule to link to an existing master rather than recreating it.
- **Phase FK** — strict database `FOREIGN KEY` constraints plus FK-aware seeding (the AI emits an
  `@users[0].id` sentinel and the seed route resolves it to the parent's Nth row id).
- **Q6 scroll** — chat scroll-to-bottom on refresh is still unreliable. The `!isStreaming` guard
  was removed, but it may still not scroll. Leading hypothesis: `scrollRef` sits on an element that
  does not actually overflow, so `el.scrollHeight === el.clientHeight` and `isAtBottom` stays
  `true`. Next step is to confirm which DOM node actually scrolls.
- **Diagnosis logging cleanup** — remove the `console.warn`/`console.log` lines in
  `loadSnapshot.ts`, `scheduleSnapshot.ts` and `useChatHistory.ts` once Q6 is confirmed fixed.
- **Data panel 500** on `POST /api/data/{chatId}/document_versions/seed` — likely a column or
  data-type mismatch in AI-generated sample rows, or the table was never properly created.
- **Phase Neon** (long-term, optional) — implement a `NeonBackend` behind `runAppQueryInSchema` if
  scale demands it.

### GitHub integration — move from PAT to a GitHub App

**Status:** push works; the connection flow is the wrong shape for non-technical users. Today a
user must visit github.com/settings/tokens, create a scoped token and paste it into Settings →
Connections, where it is stored in `localStorage` under `github_connection`. There is no OAuth. For
this audience that is a hard drop-off.

**Recommendation:** a GitHub App installed in one click, with the repo in the *user's* own account —
what Lovable and Base44 do. Repos-in-our-org was considered and rejected:

| | Repos in Prompify's org | GitHub App on user's account |
|---|---|---|
| Setup friction | none | one Install click |
| Rate limits | 5,000/hr **shared across all users** | 5,000/hr **per installation** |
| Code ownership | ours, with the liability | the user's |
| Blast radius | one org suspension kills every project | isolated per user |
| Portability | user cannot clone without an invite | they already own it |

The deciding argument: projects are **already persisted server-side**, so repos in our org would be
a second copy with worse economics, not new durability. GitHub's value to the user is ownership and
portability, which only exists when the repo is in their account.

Three things that are not what they look like:

- `app/routes/api.github.push.ts` and `app/lib/github-push.ts` are **orphaned** — zero call sites.
  The live push builds Octokit **in the browser** at `app/lib/stores/workbench.ts:701-808` using the
  `localStorage` PAT. That orphaned route is still the better skeleton to revive: it already has
  `requireAuth`, a `getCompanyMember` role check, `updateAppStatus` and an audit log.
- **No credential storage exists anywhere** — no `user_connections` or `oauth_tokens` table. The
  closest pattern to copy is `subscriptions.stripe_customer_id` with `setStripeCustomerIdForCompany`
  (`billing-db.server.ts:38-48`). `companies.github_org` already exists; an installation id belongs
  beside it — and per section 6, add it via an explicit `ALTER` plus the relevant ensure-function.
- **No new dependencies needed** — `jsonwebtoken` (RS256) and `@octokit/rest` are already direct
  deps, and prod runs Node in Docker so `crypto` is available.

No OAuth route exists to copy; `api.billing.webhook.ts` (signature verify, and `resolveCompany` for
mapping an external id to a company) is the closest model for an install callback. Genuine
user-credential consumers are only `PushToGitHubDialog`, `GithubConnection` and
`RepositorySelectionDialog`. Leave alone: `api.github-template.ts` (server env token),
`selectStarterTemplate.ts` (anonymous), `api.git-proxy.$.ts` (strips auth headers by design),
`GitUrlImport.client.tsx` (public). Dead code to clear while in there: the cookie fallbacks at
`workbench.ts:704-705` (nothing writes them) and the unused `ConnectionForm.tsx`.

Agreed scoping: company projects to the company's GitHub org, personal projects to the user's own
account. **Revisit CSRF as part of this work** — an installation callback is exactly the
cross-site redirect that weakens `SameSite=Strict`.

### Vertical / template upgrade

**Status:** brief agreed, not started. Two layers shape output and must not be confused:

1. **Framework starter templates** — `STARTER_TEMPLATES` in `app/utils/constants.ts`. Eleven
   generic starters pointing at third-party repos; an LLM in `selectStarterTemplate.ts` picks one by
   matching the prompt to each description and tags.
2. **Vertical archetypes** — `ARCHETYPE_NOTES` in `PromptingMultipleChoice.tsx:306`. Six verticals
   (crm, inventory, hr, appointment, knowledge, landing) as *text* notes injected into the prompt as
   override-able guidance. There is no per-vertical GitHub template.

**Part 1 (low-risk, do first):** expand each vertical's notes with concrete structure, feature and
UX patterns from a chosen open-source reference app. Keep the rule that the user's description
overrides the archetype. Describe patterns, not products — no brand names in generated output.
Optionally add a design reference under `app/lib/design-md/`.

**Part 2 (blocked — read before attempting):**

- **The system prompt hardcodes Vite.** `prompts.ts:26-29`, `:219`, `:266` require a
  `vite.config.ts` with `server.host=true, port=5173` and `vite` in devDependencies. That is why
  `selectStarterTemplate.ts:64` filters out any template whose name contains `shadcn` — the one
  Next.js entry, which has no vite config and serves on 3000, making the WebContainer preview
  binding unreliable. Most candidate reference apps are Next.js. Either fork them to Vite, or rework
  the prompt's framework assumptions first. The filter only affects auto-selection;
  `StarterTemplates.tsx` still renders the unfiltered list for manual picks.
- **The chosen vertical never leaves the wizard.** `app_type` is local `useState` and the component
  unmounts when chat starts. It is written to no store, cookie, DB or message annotation — only the
  archetype prose survives, baked into the first user message. Nothing downstream can map a vertical
  to a template. The `syncWorkspaceContext` / `readCachedContext` pair in that file is the pattern to
  copy if the id must outlive the wizard.
- `selectStarterTemplate` is called with the message **truncated to 500 characters**
  (`Chat.client.tsx:898`), so enriched archetype notes never reach the selector anyway.

If a real vertical base is ever cloned: fork each reference repo into Prompify's own org (for the
MIT notice, to strip the bundled backend, and to avoid third-party breakage), remove the external
backend, wire data to the runtime data layer, drop native deps, and confirm it boots in a
WebContainer. Never register a template that does not preview. Keep MIT notices; avoid
AGPL/GPL/unlicensed sources. Reference apps per vertical are tabulated in
`archive/NEXT-STEPS.md` section 3.

### Smaller items

- **`FROM_EMAIL` may still be on the Resend sandbox.** `onboarding@resend.dev` only delivers to the
  Resend account owner. Production needs `noreply@prompify.com` with the domain verified.
- **Email logo** is now linked from `APP_URL` rather than embedded, with a text wordmark fallback.
  Worth recording why: Gmail and Yahoo strip `data:` URIs in an `img src` outright, so the banner
  was never appearing on the two biggest webmail clients. A hero image becomes possible once the
  domain is live, but Gmail clips over 102 KB so it must be hosted, never embedded.
- **Pre-commit hook** was failing before this branch (`tsc` on `app/utils/markdown.ts`, prettier on
  `Button.tsx`), fixed in `85c4962`. That means recent commits either bypassed the hook or a
  dependency drifted — worth understanding which, and a good moment to add secret scanning
  (section 13).
- **`docs/archive/CONTEXT-HANDOFF.md` still contains a live-looking `DASHSCOPE_API_KEY` fragment**
  and a rotated database password. Scrub it if the archive is ever tracked.

### Platform capability gaps (product)

Added 2026-10-29 after a read of the full route surface, the data layer and the prompt system.
These are **product capability** gaps, distinct from the ordered list above, which is ops and
technical debt. Each entry records the evidence, because the first one is easy to disbelieve.

#### CAP-1 — generated apps have no end-user identity

**The deployed app is single-identity: every visitor acts as the builder.**

Evidence:

- `api.data.token.ts:33-36` — only the chat owner gets a data token. Non-owner chat members are
  refused with 403: *"v1 strict schema-per-user: only the owner (or moderator) gets a data token."*
- `api.deploy.ts:165-167` — at deploy time a token is minted and written into the app's
  `env-config.js`. 15 minutes normally; **7 days when the user clicks Share**.
- `lib/.server/data-auth.ts:14-16` already states the consequence plainly: *"a shared deploy embeds
  a 7-day token in `env-config.js`, which is public in the deployed app."* The cross-chat scope
  leak was fixed there; the single-identity property was not, because it is a design property, not
  a bug.
- Token claims are `{ userId, chatId, role: 'data_proxy' }` (`lib/.server/data-token.ts`). There is
  no claim that could represent "the person currently using the app".

Three consequences:

1. **The apps the archetypes describe cannot be built.** A CRM where each rep sees their own
   leads, an HR app with manager and employee views, an approval queue — all need per-user data,
   and the data layer has no concept of an app end user.
2. **Any login screen the AI generates is cosmetic.** The token is in client-side JavaScript, so a
   visitor can call the data proxy directly and bypass whatever UI gate was generated.
3. **A shared app stops working after 7 days** when the embedded token expires.

This is also a promise mismatch. `PromptingMultipleChoice.tsx:340-355` (`USER_SCOPE`) instructs the
model to build *"Public signup flow with email verification. OAuth social login (Google, GitHub).
Password reset"*, *"SSO-ready (SAML/OIDC)"* and *"Role-based routing to separate interfaces"*. The
runtime cannot enforce any of it. The README's "shared identity, company SSO propagated to all
apps" rests on the same missing piece.

**Shape of a fix.** Isolation today is schema-per-builder (`usr_<userId>`, see
`data-provision.server.ts`), so end-user separation has to be row-level inside those tables, not a
new schema per person. Sketch:

- an app-end-user table per app, and a convention column (e.g. `app_user_id`) on generated tables;
- an `endUserId` claim added to the data token, issued after the end user authenticates;
- the data proxy filtering by that claim in `data-auth.ts` / `api.data.$chatId.$resource.ts` —
  one gate, already consolidated there, which is why this is tractable;
- a prompt change so generated apps use the platform's identity rather than inventing their own.

Note `app_tables` already carries `workspace_type` and `workspace_id` (`schema.sql:697-711`), so
the registry is partly workspace-aware even though the proxy is owner-only.

#### CAP-2 — no file or blob storage for generated apps

The system prompt offers generated apps a database and nothing else; a grep of `prompts.ts` for
storage finds only `localStorage`. No attachments, profile photos, receipts, documents or file
import — in a product whose named verticals are CRM, HR and inventory.

**Mostly already built.** `lib/.server/storage.ts` plus `api.snapshots.upload-url` already do
presigned-PUT uploads to S3-compatible object storage (Huawei OBS, `S3_*` in `.env.example`), with
the key derived server-side to prevent traversal. The work is exposing that primitive to generated
apps with per-app scoping and quotas — not building storage.

#### CAP-3 — no scheduled jobs for generated apps

No cron primitive is offered. That rules out reminders, digests, recurring invoices, nightly syncs
and SLA escalation — a large share of real internal-tool use cases, and a prerequisite for the
"approval workflow" item in the Phase 3 list.

A scheduler already exists in crude form: the `cron` service in `docker-compose.prod.yaml` is a
`curlimages/curl` container in a `sleep 900` loop hitting `/api/cron/*` with `CRON_SECRET`. It is
fine for a handful of fixed platform jobs and is **not** a basis for per-app user-defined
schedules; treat that as a real build.

#### CAP-4 — generated apps cannot send email

The platform sends its own auth and billing mail through Resend (`app/lib/email.ts`, section 10),
but generated apps have no way to send. No notifications, invitations or approval requests.
Transport, templates and a verified sender already exist; what is missing is a scoped, rate-limited
endpoint and the reputation question of sending on users' behalf.

#### CAP-5 — no per-app secrets

A user cannot give a generated app a third-party credential (Stripe, Slack, their own CRM), so
every generated app is an island. `env-config.js` is the obvious delivery mechanism, but note it is
**public in the deployed app** — anything placed there is readable by any visitor, so secrets
needed server-side must be proxied, never injected. See CAP-1.

#### CAP-6 — deployed apps are unobservable

No error capture, no logs, no uptime, no analytics for deployed apps; the only error-reporting code
in the tree is platform debug tooling (`lib/api/debug.ts`). When a user's internal app breaks, they
learn about it from a colleague and we have nothing to debug with. Section 14 already records that
`/api/metrics` and `/api/health` exist with nothing consuming them — the same blind spot, one layer
down.

The business-facing half is equally dark: which verticals convert, where generation fails, and
which deployed apps are actually used are all unmeasured — exactly the data that should be driving
the vertical/template work above.

#### CAP-7 — smaller

- **No first-run onboarding.** Only the wizard exists; for the non-technical operator the product
  targets, there is no guided path to a first working app.
- **Search is description-only.** `Menu.client.tsx:88-90` filters already-loaded chats by
  `description` client-side. No full-text across messages or code.
- **No "clone this app".** The cheapest possible version of the Phase 3 template marketplace, using
  apps users have already built.

#### Caveat

This came from reading the code, not from customer evidence. If current users are mostly building
single-operator dashboards, CAP-1 matters less than the architecture suggests. Worth checking
against real usage before committing a quarter to it — which CAP-6 would tell us.

---

## 16. Archive index

Originals, verbatim. Tracking here is deliberately mixed:

- **Tracked** (they already were, and carry no secrets): `CONTRIBUTING.md`, `FAQ.md`,
  `EMAIL-SETUP.md`, `STRIPE-SETUP.md`, and both `DEPLOYMENT-2026-07-27-*` files.
- **Untracked** (`.gitignore` has `*.md`), so they live only on this disk — back them up before
  wiping a machine: `ARCHITECTURE-v2.md`, `PROMPIFY-INTERNAL-DOCS.md`, `CONTEXT-HANDOFF.md`,
  `SECURITY_NOW.md`, `NEXT-STEPS.md`, `DEPLOY.md`, `claude-outputs/`.

`CONTEXT-HANDOFF.md` must **stay untracked** until scrubbed: it contains a real
`DASHSCOPE_API_KEY` fragment and a since-rotated database password.

| File | Lines | What it holds |
|---|---|---|
| `archive/ARCHITECTURE-v2.md` | 982 | The definitive database architecture: platform schema, schema-per-app runtime data, content-addressed snapshots, version control, offline resilience, data-proxy integration, cost analysis, phased implementation, security model, tested failure scenarios |
| `archive/PROMPIFY-INTERNAL-DOCS.md` | 775 | Engineering reference: layered architecture, dual-runtime notes, request lifecycle, end-to-end flows, table catalog, the migrations hazard, load-bearing invariants, deployment, testing, roadmap, glossary |
| `archive/CONTEXT-HANDOFF.md` | 303 | September 2026 session handoff: 13 commits with rationale, workspace-model decisions, key files and their roles. **Contains secret fragments and a stale cert date — historical only** |
| `archive/SECURITY_NOW.md` | 296 | The 2026-06-26 forensic audit with 2026-07-17 remediation: per-finding detail, provenance via pickaxe and blame, per-route auth posture. **Appendix A is stale on two points — see section 12** |
| `archive/NEXT-STEPS.md` | 283 | Open work with full context, including the per-vertical reference-app table and the mobile audit |
| `archive/STRIPE-SETUP.md` | 243 | Full Stripe runbook, condensed into section 11 |
| `archive/CONTRIBUTING.md` | 242 | Inherited from bolt.diy; written for public OSS contributors |
| `archive/EMAIL-SETUP.md` | 227 | Full Resend runbook, condensed into section 10 |
| `archive/FAQ.md` | 131 | Inherited from bolt.diy |
| `archive/DEPLOY.md` | 95 | The deploy runbook, carried into section 5 |
| `archive/DEPLOYMENT-2026-07-27-ENV-ADDITIONS.txt` | — | Superseded by the 2026-07-30 upgrade |
| `archive/DEPLOYMENT-2026-07-27-PREFLIGHT.sql` | — | Superseded by the 2026-07-30 upgrade |
| `archive/claude-outputs/` | — | Prior session reports: deployment/healthcheck, template-upgrade prompt |

Also in `docs/`: `Prompify-Technical-Infrastructure-Proposal.pdf`.

Elsewhere in the repo: `data/DBProposal.md` (the twelve-option database evaluation) and
`app/lib/design-md/*.md` — the latter are **product data**, design-system prompts fed to the LLM,
not documentation. `.gitignore` explicitly un-ignores them.
