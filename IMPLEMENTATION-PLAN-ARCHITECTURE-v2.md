# Prompify — ARCHITECTURE-v2 Daily Implementation Guide

> **Source of truth:** [`ARCHITECTURE-v2.md`](ARCHITECTURE-v2.md). Every step below cites the doc section that mandates it and the current code it touches.
> **Working branch:** `feat/persistence-architecture-v2` (off `EulerOS` @ `b37f5e6`).
> **Rule of this document:** assume every step is wrong until the 3 sources line up. Where a step lacks 3 verifiable sources it is marked **NEEDS INVESTIGATION** instead of being asserted.

---

## Section 1: Prerequisites & Setup

### 1.1 Branch — already created
```bash
# Done during planning. To reproduce from scratch:
git checkout EulerOS
git checkout -b feat/persistence-architecture-v2
git rev-parse --abbrev-ref HEAD          # => feat/persistence-architecture-v2
git rev-parse --short EulerOS            # => b37f5e6 (UNCHANGED — proves EulerOS untouched)
```

### 1.2 Why base off `EulerOS`, not `main` (evidence, not preference)
- **Source 1 (code absence on main):** `git cat-file -e main:app/lib/database-postgresql.ts` → **ABSENT**. The PostgreSQL layer (`getPostgresPool`, `createPostgresTables`, `saveChatPostgres`, `getChatByIdPostgres`) that the doc extends lives **only** on EulerOS.
- **Source 2 (doc assumes these exist):** `ARCHITECTURE-v2.md:23` "PostgreSQL 15 is running and connected | `database-postgresql.ts:11-33`"; `:27` references `api.deploy.ts:114-137` and `supabase-provision.server.ts`; `:30` references `auth.ts:82-107`.
- **Source 3 (presence on EulerOS):** `git cat-file -e EulerOS:<path>` returns EXISTS for `app/lib/database-postgresql.ts`, `app/lib/auth.ts`, `app/lib/supabase-provision.server.ts`, `app/routes/api.deploy.ts`, `app/lib/common/prompts/prompts.ts`, `app/lib/stores/workbench.ts`, `app/lib/runtime/action-runner.ts`, `app/lib/persistence/db.ts`.
- **Conclusion:** basing on `main` would require first re-porting ~262 files / +64k LOC. Basing on EulerOS is the only defensible choice. **VERDICT: PROVEN.**

> ⚠️ **Doc path error to remember:** the doc says `auth.ts:82-107` and `.server/auth.ts` in places; the real path is `app/lib/auth.ts` (`app/lib/.server/auth.ts` is ABSENT). Use the real path.

### 1.3 Environment / credentials needed before Day 1
| Need | Why | Doc ref | Verify |
|---|---|---|---|
| S3-compatible bucket + keys (Huawei OBS **or** GCS-interop **or** R2 **or** local MinIO) | Blob storage for snapshots | `ARCHITECTURE-v2.md:70-74, 872` | `aws --endpoint $S3_ENDPOINT s3 ls` lists the bucket |
| `DATA_API_SECRET` env (only if Phase 4 attempted) | Separate secret from `JWT_SECRET` | `:318, 900` | Deferred — see Scope note |
| Running local Postgres (compose `postgres` service) | All DDL/queries | `docker-compose.prod.yaml:5-25` | `docker compose --profile production up postgres` then `pg_isready` |
| Node ≥ 18.18 + pnpm 9 | Build/test toolchain | `package.json:36-37, 192` | `node -v && pnpm -v` |

> **NOTE (deviation, flagged):** the doc hard-names **Cloudflare R2**. Deployment target is **Huawei/Google Cloud**. The doc's Part 10 (`:872`) explicitly requires a provider-agnostic S3 abstraction. This plan therefore uses `@aws-sdk/client-s3` against a configurable `S3_ENDPOINT`. This is a *conflict resolution*, declared here, not a silent substitution. **Decision in 1.4a below.**

### 1.4a Object storage provider — DECISION: Huawei OBS (not Cloudflare R2)

**Chosen: Huawei OBS.** Evidence the project is already on Huawei: `docker-compose.yaml:32` `# Updated for ECS Euler Huawei OS`; KooGallery (Huawei Cloud Marketplace) integration at `app/routes/api.koogallery.*` + `init-db.sql:100-129`. Same-region ECS↔OBS = low latency, **zero inter-cloud egress**.

| Factor | Huawei OBS (CHOSEN) | Google Cloud Storage (fallback) |
|---|---|---|
| S3 API + SigV4 presigned URLs | **Native** — works with `@aws-sdk/client-s3` as Day 1 is written | aws-sdk presigned URLs **unreliable** on GCS; needs `@google-cloud/storage` V4 signing |
| Impact on Day 1 | None (drop-in) | **Rewrites Day 1 adapter** (different SDK) |
| Egress from your ECS | Same cloud → none | Cross-cloud → you pay |

> If a hard "must be Google" mandate appears: Day 1 must use `@google-cloud/storage` instead of `@aws-sdk/client-s3`, and Risk **R2** (presigned URLs on non-R2) becomes a Day-1 blocker, not a Day-5/7 one.

**OBS env (replaces the generic S3_* in Day 1.2):**
```
S3_ENDPOINT=https://obs.<region>.myhuaweicloud.com   # e.g. ap-southeast-3
S3_REGION=<region>
S3_BUCKET=prompify-snapshots                          # PRIVATE bucket
S3_ACCESS_KEY_ID=<OBS AK>
S3_SECRET_ACCESS_KEY=<OBS SK>
# @aws-sdk/client-s3: forcePathStyle=false (OBS supports virtual-hosted style)
```

### 1.4b Target VM specification (ESTIMATE — no resource limits exist in repo)

**Why this is an estimate:** no `cpus`/`mem_limit`/`shared_buffers`/`max_connections` are set in any compose/config (verified). Numbers are grounded in (a) the services that exist in `docker-compose.prod.yaml` and (b) the doc's own line `:775` "Server RAM upgrade (4GB → 8GB)".

**Two facts that keep the VM small:**
- WebContainer runs in the **browser** (`app/lib/webcontainer/index.ts:50`) → the VM never runs users' generated apps.
- Snapshot blob bytes go **client ↔ OBS directly** via presigned URL (`ARCHITECTURE-v2.md:356, 422`) → object-storage traffic does **not** transit the VM.

What runs on the VM (`docker-compose.prod.yaml`): `app` (Remix), `postgres`, `redis`, `nginx`, `certbot`, `cron`. ARCHITECTURE-v2 (scoped Phases 1,2,3-runtime,5,6) adds **no new server process** — new tables are tiny rows in the existing Postgres; new endpoints live in the existing Remix app; GC is a nightly cron call.

| | Minimum (impl/staging) | **Recommended (prod)** |
|---|---|---|
| vCPU | 2 | **4** |
| RAM | 4 GB (tight until Day 14 drops Vite-dev) | **8 GB** (doc `:775`) |
| Huawei ECS flavor* | `s7.large.2` (2c/4G) | **`s7.xlarge.2` (4c/8G)** or `c7.xlarge.2` |
| System disk | 40 GB SSD | 40 GB SSD |
| Data disk (EVS: PG + WAL + Docker) | 80 GB SSD | **100 GB SSD** (ultra-high I/O) |
| OS | EulerOS (current host) | EulerOS |
| EIP bandwidth | 5 Mbps / pay-by-traffic | 5–10 Mbps — **low; blobs bypass the VM**, only LLM text + page loads transit |
| OBS | private bucket, same region | + lifecycle rule for GC (Day 18) |

*Huawei flavor names from general knowledge — **verify in Huawei console**. `s7.xlarge.2` = 4 vCPU × RAM-ratio-2 = 8 GB.

**One VM covers this entire 20-day implementation.** Add a 2nd VM only on proven triggers: Postgres→own VM when pool `max:20` (`database-postgresql.ts:21`) contends or backup I/O competes; a 2nd app replica only **after Day 14** (today's `pnpm run dev` prod mode, `docker-compose.prod.yaml:129`, isn't built to scale out); read replica "at 1,000+ users" (doc `:59`). PgBouncer is a process on the existing VM, **not** a new VM (doc `:772`). OBS needs no VM.

### 1.4 Verify starting state is correct (run before Day 1)
```bash
git rev-parse --abbrev-ref HEAD                 # feat/persistence-architecture-v2
pnpm install                                    # deps resolve
pnpm test                                        # baseline: 3 spec files pass (see Section 2 warning)
pnpm run build                                    # remix vite:build succeeds -> build/server/index.js exists
ls build/server/index.js                          # MUST exist (needed for Day 12-13)
```

---

## Section 2: Architecture Summary

### 2.1 In plain language
Store every generated app's **files** as content-addressed blobs (keyed by SHA-256) in S3-compatible object storage, with a tiny **manifest** (`{path: hash}`) per version in Postgres. Cache the latest version's full file content in the browser's IndexedDB. On project load, restore from IndexedDB (instant) → else server manifest + blobs → else fall back to today's slow message-replay. Add an **offline queue** + **circuit breaker** so the IDE keeps working when the server is down. Add **version history + rollback**. (Phase 4 — a Remix data proxy replacing Supabase for runtime app data — is **deferred**, see 2.4.)

### 2.2 Already exists (proven) — do NOT rebuild
| Capability | Evidence |
|---|---|
| Postgres pool + `createPostgresTables()` | `app/lib/database-postgresql.ts:11-33, 35-520` |
| Chat dual-write (IndexedDB + Postgres) | `app/lib/persistence/useChatHistory.ts:178-238` |
| IndexedDB `boltHistory` v1, `chats` store | `app/lib/persistence/db.ts:21-31` |
| Chat load with try/catch + fallback to `/api/chat/:id` | `useChatHistory.ts:70-134` |
| Global ErrorBoundary | `app/root.tsx:86-88` |
| Message replay (Tier-3 restore) via boltAction parsing | `app/lib/runtime/action-runner.ts`, `app/lib/runtime/message-parser.ts` |
| Netlify deploy + env-config injection | `app/routes/api.deploy.ts` (Netlify), Supabase env-config present |
| Cron container (for GC) | `docker-compose.prod.yaml:132-150` |
| Compiled Node server (Vite-free runtime) **written but unwired** | `server.js:1-28` |

### 2.3 Net-new (proven absent) — this plan builds it
| Thing | Proof of absence |
|---|---|
| `codebase_versions`, `codebase_blobs` tables | not in `database-postgresql.ts:35-520` |
| Any object-storage SDK | `@aws-sdk/client-s3` / `@google-cloud/storage` not in `package.json:39-188` |
| IndexedDB `snapshots`, `pendingWrites` stores | `db.ts:21-31` has only `chats`, version `1` |
| Snapshot build / dedup / upload / version endpoints | no `api.snapshots.*` or `api.chats.$id.version.*` routes |
| Circuit breaker / outbox queue | no matches in `app/` |
| Version history UI / rollback | no matches |

### 2.4 Known conflicts between doc and code (FLAGGED, per protocol rule 4)
1. **R2 "already implemented" (`:870`) is false.** Zero storage code exists. → Plan treats it as greenfield, S3-abstracted (see 1.3).
2. **`auth.ts` path wrong in doc (`:30`).** → Use `app/lib/auth.ts`.
3. **`is_latest` partial unique index requires the `FOR UPDATE` lock (`:388-392`)** — correct in doc; plan keeps it.
4. **Doc Phase 3 "remove Vite" already has a written `server.js`** that is unreferenced by any CMD (`Dockerfile:64` runs `dockerstart`; `docker-compose.prod.yaml:129` runs `pnpm run dev`). → Plan wires the existing `server.js` rather than writing new (Days 12-13).
5. **No test coverage** for any touched area (see 2.5). → Plan writes characterization tests first.

### 2.5 ⚠️ TOP RISK — the test suite does not cover what we change
`pnpm test` runs only `app/lib/runtime/message-parser.spec.ts`, `app/components/chat/Markdown.spec.ts`, `app/utils/diff.spec.ts` (`Glob app/**/*.spec.ts`). **None** touch persistence, DB, routes, workbench, or deploy. Therefore "all tests pass" is a **necessary but wildly insufficient** gate. Every day that changes behavior must (a) add a focused test for the *current* behavior first, then (b) verify the new behavior with a **scripted manual check** (curl / browser steps) recorded in Post-Conditions.

### 2.6 Scope for these 20 days (and what is deferred, with justification)
**IN:** Phase 1 (snapshots, Days 1-9), Phase 2 (offline, Days 10-12), Phase 3 runtime-only = wire `server.js` (Days 13-14), Phase 5 (version UI, Days 15-17), Phase 6 (GC + monitoring, Days 18-19), hardening (Day 20).
**DEFERRED (out of these 20 days):**
- **Phase 4 (Remix data proxy + Supabase migration).** Justification: doc `:757` "Migration is a cost optimization, not a reliability fix"; it is 5-7 days alone (`:834`), security-sensitive (new auth secret, RLS, schema-per-app), and does not fit the remaining budget. Tracked in Section 6.
- **Phase 3 scaling (PgBouncer, read replica, multi-replica).** Justification: doc marks these "added at 1,000+ users" (`:59, 774`); premature now. Tracked in Section 6.

---

## Section 3: Daily Implementation Plan

> Convention: each day ≤4h coding. Each day starts and ends with `pnpm test`. "New behind a flag" means gated by `VITE_SNAPSHOTS_ENABLED` (client) / `SNAPSHOTS_ENABLED` (server) so every day ships a working system. Replace-by-addition: new module Day N, switch consumers Day N+1, delete old Day N+2.

---

## Day 1: Storage abstraction module (S3-compatible) — additive, no consumers yet

### Goal
A tested `app/lib/.server/storage.ts` exposing `putObject`, `getObject`, `headObject`, `getPresignedPutUrl`, `getPresignedGetUrl` against a configurable S3 endpoint — imported by nothing yet.

### Why This Day
- Requires: nothing (greenfield).
- Enables: Day 4 (dedup `headObject`), Day 5 (presigned upload), Day 8 (restore download).
- Ordering evidence: Days 4/5/8 cannot reference storage that doesn't exist; everything blob-related roots here.

### Pre-Conditions
- [ ] `pnpm test` passes (3 specs).
- [ ] `git status` clean except pre-existing `vite.config.ts`, `architecture-presentation.html`.
- [ ] S3 bucket reachable: `aws --endpoint $S3_ENDPOINT s3 ls $S3_BUCKET`.

### Detailed Steps
#### Step 1.1: Add dependency
- **What:** `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.
- **Why:** `ARCHITECTURE-v2.md:872` "Changing R2 → MinIO requires only updating S3 endpoint config" (S3 API). `:884` shows `downloadBlobs` via presigned URLs.
- **Current state:** `package.json:39-188` has no S3 SDK (proven absent).
- **Target:** two new deps in `dependencies`.
- **What could break:** lockfile churn; pnpm peer warnings. Low risk — purely additive.
- **Verification:** `pnpm ls @aws-sdk/client-s3` shows a version; `pnpm run build` still succeeds.

#### Step 1.2: Write `app/lib/.server/storage.ts`
- **What:** module that reads `S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY` from `process.env`, lazily constructs one `S3Client` (mirror the lazy-singleton pattern of `getPostgresPool()`), and exports the 5 functions above. Keys are derived `blobs/<sha[0:2]>/<sha[2:4]>/<sha>` per `:154`.
- **Why:** `:178` content-addressed keys; `:355` 60s presigned PUT; `:413` presigned GET.
- **Current state:** new file; pattern reference is `database-postgresql.ts:11-33` (lazy singleton + `process.env` guard).
- **Target:** pure module, no Remix imports, lives under `.server/` so it never enters the client bundle (matches `app/lib/.server/llm/` convention).
- **What could break:** accidental client import → build error (CORP/bundle). Mitigated by `.server` suffix.
- **Verification:** unit test below.

#### Step 1.3: Characterization test
- **What:** `app/lib/.server/storage.spec.ts` — test key derivation (`keyForHash('abc...')` → `blobs/ab/c.../abc...`) with a mocked client. No live network.
- **Why:** Section 2.5 — no existing coverage; lock behavior before consumers arrive.
- **Verification:** `pnpm test` includes and passes the new spec.

### Post-Conditions
- [ ] `pnpm test` passes incl. `storage.spec.ts`.
- [ ] `pnpm run build` succeeds; `storage.ts` not present in `build/client` (grep the client bundle).
- [ ] Committed: `feat(storage): add S3-compatible storage abstraction (no consumers yet)`.

### Rollback Plan
1. `git revert HEAD` (single commit, no consumers) → `pnpm install`.
2. Verify: `pnpm test && pnpm run build`.

### Red Flags — Stop if:
- `storage.ts` ends up in the client bundle (CORP/secret leak).
- You feel the urge to call it from a route today — don't; that's Day 4+.

---

## Day 2: Postgres tables `codebase_versions` + `codebase_blobs` (additive DDL)

### Goal
`createPostgresTables()` creates the two new tables + indexes idempotently; no code reads/writes them yet.

### Why This Day
- Requires: nothing (DDL is independent of storage).
- Enables: Day 6 (version save), Day 7 (version load), Day 18 (GC).
- Ordering evidence: version endpoints (Day 6+) INSERT into these tables; tables must pre-exist.

### Pre-Conditions
- [ ] `pnpm test` passes.
- [ ] Local Postgres up; `createPostgresTables()` currently runs clean.

### Detailed Steps
#### Step 2.1: Append DDL inside `createPostgresTables()`
- **What:** add the two `CREATE TABLE IF NOT EXISTS` + 4 indexes from `:122-160`, appended **after** existing tables (around `database-postgresql.ts:511`, before the final `console.log`), inside the same try/catch.
- **Why:** `ARCHITECTURE-v2.md:118-161` (table DDL) and `:797` "Add `codebase_versions` and `codebase_blobs` tables to `createPostgresTables()`".
- **Current state:** `database-postgresql.ts:35-520` creates 22 tables idempotently; FK target `chats(id)` exists at `:131-147`, `users(id)` at `:42`.
- **Target:** two more `await client.query(...)` blocks; FKs `REFERENCES chats(id)`, `REFERENCES users(id)` both already exist (Source 3 dependency check ✓).
- **What could break:** if DDL throws, the whole `createPostgresTables` try/catch rethrows (`:514-516`) → app boot fails. Mitigated by `IF NOT EXISTS` + valid FKs.
- **Verification:** `psql -c '\d codebase_versions' && psql -c '\d codebase_blobs'`.

#### Step 2.2: Mirror DDL into `init-db.sql` (consistency)
- **What:** add the same two tables to `init-db.sql` **after** the `chats` table (which it does create at... — NOTE: `init-db.sql` creates `chats` but NOT `projects`; place new tables after `chats` so FKs resolve).
- **Why:** keep fresh-container init aligned with app-boot DDL.
- **What could break:** `init-db.sql` already has a latent ordering bug (`ALTER TABLE projects` with no `CREATE TABLE projects`, `init-db.sql:355`). Do **not** depend on `projects` here; our new FKs target `chats`/`users` only.
- **Verification:** spin a fresh `postgres` container → check both tables exist.

### Post-Conditions
- [ ] Both tables + 4 indexes exist after app boot AND after fresh container init.
- [ ] `pnpm test` passes (no test change; DDL only).
- [ ] Committed: `feat(db): add codebase_versions + codebase_blobs tables`.

### Rollback Plan
1. `git revert HEAD`. Tables already created are harmless (unused). To drop: `DROP TABLE codebase_blobs, codebase_versions;`.
2. Verify: app boots, `pnpm test` passes.

### Red Flags — Stop if:
- `createPostgresTables()` now throws on boot (means an FK target is missing — re-check `chats`/`users`).

---

## Day 3: `buildSnapshot()` — extract files + SHA-256 (pure client util, additive)

### Goal
A tested pure function that turns WebContainer/WorkbenchStore file state into `{ manifest: {path:sha}, files: {path:content} }`, excluding `node_modules`, `.git`, binaries >1MB.

### Why This Day
- Requires: nothing (pure function over an in-memory map).
- Enables: Day 6 (save sends manifest), Day 4 (dedup needs hashes), Day 8 (restore writes files).
- Ordering evidence: every snapshot op consumes `buildSnapshot` output.

### Pre-Conditions
- [ ] `pnpm test` passes.
- [ ] Confirm the file source: read `app/lib/stores/files.ts` and `app/lib/stores/workbench.ts` to find the current files map shape (the `FilesStore`/`#files` map). **NEEDS INVESTIGATION until read** — do not assume the exact accessor.

### Detailed Steps
#### Step 3.1: Implement `app/lib/snapshots/buildSnapshot.ts`
- **What:** `export async function buildSnapshot(files: FileMap): Promise<{manifest, files}>`; compute `sha256` via `crypto.subtle.digest('SHA-256', ...)` per `:345`; skip excludes per `:342`.
- **Why:** `ARCHITECTURE-v2.md:340-346, 798` "Implement `buildSnapshot()` — extract files from WorkbenchStore, compute SHA-256".
- **Current state:** WorkbenchStore exists (`app/lib/stores/workbench.ts`); exact file-map getter to confirm in Pre-Conditions.
- **Target:** pure function, deterministic, no network.
- **What could break:** wrong file-map shape → empty manifest. Mitigated by reading `files.ts` first + tests.
- **Verification:** unit test with a fixed input map → stable hashes.

#### Step 3.2: Test (golden hashes)
- **What:** `buildSnapshot.spec.ts` with 2 files of known content → assert exact SHA-256 hex and that `node_modules/x` is excluded.
- **Verification:** `pnpm test`.

### Post-Conditions
- [ ] `pnpm test` passes incl. new spec.
- [ ] No consumer imports it yet (still additive).
- [ ] Committed: `feat(snapshots): buildSnapshot file extraction + hashing`.

### Rollback Plan
1. `git revert HEAD`. No consumers → safe.

### Red Flags — Stop if:
- You cannot find a stable file-map accessor in WorkbenchStore → STOP, this invalidates Days 4-9 ordering; re-plan around the real API.

---

## Day 4: Dedup endpoint `POST /api/snapshots/dedup` (server, flag-gated)

### Goal
Endpoint takes `{hashes:[...]}`, returns `{missing:[...]}` by checking `codebase_blobs` — behind `SNAPSHOTS_ENABLED`.

### Why This Day
- Requires: **Day 2** (`codebase_blobs` table), **Day 1** (storage, optional `headObject` cross-check).
- Enables: Day 5 (upload only missing), Day 6 (save).
- Ordering evidence: dedup reads `codebase_blobs.sha256` (Day 2 output).

### Pre-Conditions
- [ ] Day 2 tables exist; Day 1 storage merged.
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 4.1: Route `app/routes/api.snapshots.dedup.ts`
- **What:** `action` reads JSON, `SELECT sha256 FROM codebase_blobs WHERE sha256 = ANY($1)`, returns set difference. Gate: if `process.env.SNAPSHOTS_ENABLED !== 'true'` → `404`.
- **Why:** `ARCHITECTURE-v2.md:348-351, 799`.
- **Current state:** route pattern per existing `app/routes/api.chats.ts` (action + `getPostgresPool`).
- **Target:** new route, auth via existing session check (reuse `app/lib/auth.ts` helper used by `api.chats.ts` — confirm the helper name in pre-conditions).
- **What could break:** unauth access → info leak of hashes. Mitigated by requiring valid session (Source 3: `api.chats.ts` shows the auth guard pattern).
- **Verification:** `curl -X POST /api/snapshots/dedup -d '{"hashes":["x"]}'` → `{"missing":["x"]}` when flag on; `404` when off.

### Post-Conditions
- [ ] Flag off → `404` (system unchanged). Flag on → correct diff.
- [ ] `pnpm test` passes; add route test mocking the pool.
- [ ] Committed: `feat(snapshots): dedup endpoint (flag-gated)`.

### Rollback Plan
1. `git revert HEAD`. Flag-gated → zero prod impact even unreverted.

### Red Flags — Stop if:
- You can't reuse the existing session-auth helper → don't invent a new auth path; investigate `api.chats.ts` first.

---

## Day 5: Presigned upload `POST /api/snapshots/upload-url` + client blob upload (flag-gated)

### Goal
Server issues a 60s presigned PUT for a missing hash; client PUTs blob content directly to object storage.

### Why This Day
- Requires: **Day 1** (`getPresignedPutUrl`), **Day 4** (knows which are missing).
- Enables: Day 6 (version save references uploaded blobs).
- Ordering evidence: upload consumes Day 4's `missing` list and Day 1's presigner.

### Pre-Conditions
- [ ] Days 1 & 4 merged; bucket writable.
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 5.1: Route `app/routes/api.snapshots.upload-url.ts`
- **What:** `{hash,size}` → validate hash `^[a-f0-9]{64}$`, return `getPresignedPutUrl(keyForHash(hash), 60)`. Flag-gated + session-auth.
- **Why:** `:354-357, 800`.
- **What could break:** unbounded `size`, path traversal via hash. Mitigated by regex + server-derived key.
- **Verification:** obtain URL → `curl -X PUT --upload-file` → object appears in bucket.

#### Step 5.2: Client uploader `app/lib/snapshots/uploadBlobs.ts`
- **What:** given `missing` + `files`, request URL per hash, PUT content.
- **Why:** `:356` "Client PUTs file content directly to R2".
- **Verification:** integration check Day 9.

### Post-Conditions
- [ ] Flag on → blob lands in bucket; flag off → `404`.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(snapshots): presigned upload + client uploader`.

### Rollback Plan
1. `git revert HEAD` (two files). Bucket objects are orphan-harmless (GC handles later).

### Red Flags — Stop if:
- Presigned PUT rejected by Huawei OBS/GCS (signature/region mismatch) → resolve endpoint/region config before Day 6 (this is the riskiest external assumption — see Section 6).

---

## Day 6: Version save `POST /api/chats/:id/version` (transactional, FOR UPDATE)

### Goal
One transaction: lock chat, flip `is_latest`, insert version, upsert blobs, bump `ref_count`.

### Why This Day
- Requires: **Day 2** (tables), **Day 3** (manifest shape). (≤2 prior days ✓)
- Enables: Day 8 (restore reads latest), Day 15 (version list), Day 18 (GC ref_count).
- Ordering evidence: restore/list/GC all read rows this writes.

### Pre-Conditions
- [ ] Days 2 & 3 merged.
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 6.1: Route `app/routes/api.chats.$id.version.ts`
- **What:** implement the exact transaction from `:361-376` (`BEGIN; SELECT 1 FROM chats WHERE id=$1 FOR UPDATE; UPDATE ... is_latest=false; INSERT ...; UPDATE codebase_blobs SET ref_count=ref_count+1 WHERE sha256 = ANY(...); INSERT ... ON CONFLICT DO NOTHING; COMMIT;`). Compute `version_number = COALESCE(MAX,0)+1`. Flag-gated + ownership check.
- **Why:** `:359-392, 801`. Lock rationale `:388-392`.
- **Current state:** transaction pattern exists in `database-postgresql.ts:1131-1150` (`insertTokenUsageAndConsumePostgres` BEGIN/COMMIT/ROLLBACK) — reuse it.
- **Target:** put DB logic in a new `saveCodebaseVersionPostgres()` in `database-postgresql.ts` (consistent with file's function style), called by the route.
- **What could break:** partial unique index `idx_versions_latest_per_chat` rejects a 2nd `is_latest` insert under concurrency → the `FOR UPDATE` lock prevents it. Ownership bypass → reuse `getChatByIdPostgres` access check (`:1554-1564`).
- **Verification:** save twice → `version_number` 1 then 2; only one `is_latest=true`.

### Post-Conditions
- [ ] Two saves → rows v1 (is_latest=false), v2 (is_latest=true); `ref_count` incremented.
- [ ] Concurrent double-POST → no error, no lost row (test with 2 parallel curls).
- [ ] `pnpm test` passes incl. a transaction test.
- [ ] Committed: `feat(snapshots): transactional version save`.

### Rollback Plan
1. `git revert HEAD`. Existing chat save path untouched (separate route).

### Red Flags — Stop if:
- A save ever throws "duplicate key ... is_latest" → the lock isn't being taken; STOP and fix before wiring (Day 9).

---

## Day 7: Version load `GET /api/chats/:id/version/latest` (presigned GET URLs)

### Goal
Return latest manifest + a presigned GET per blob.

### Why This Day
- Requires: **Day 6** (rows to read), **Day 1** (`getPresignedGetUrl`).
- Enables: Day 8 (client download/mount).
- Ordering evidence: returns what Day 6 wrote, using Day 1 presigner.

### Pre-Conditions
- [ ] Days 1 & 6 merged.
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 7.1: Route `app/routes/api.chats.$id.version.latest.ts`
- **What:** `SELECT manifest FROM codebase_versions WHERE chat_id=$1 AND is_latest` → for each `{path:hash}` produce `{path, url: getPresignedGetUrl(keyForHash(hash), 60)}`. Flag-gated + ownership.
- **Why:** `:411-413, 802`.
- **What could break:** null when no version → return `{version:null}` (client falls to Tier-3 per `:424`). Ownership bypass → reuse access check.
- **Verification:** after a Day 6 save, `curl` returns manifest + URLs; URLs GET the right bytes.

### Post-Conditions
- [ ] Returns manifest+URLs for a saved chat; `{version:null}` for a never-saved chat.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(snapshots): latest version load with presigned GETs`.

### Rollback Plan
1. `git revert HEAD`. Read-only route; no state to undo.

### Red Flags — Stop if:
- Presigned GET 403s from the provider → same external-config risk as Day 5; resolve before Day 8.

---

## Day 8: IndexedDB v2 (`snapshots` store) + client restore/mount (flag-gated)

### Goal
IndexedDB upgrades to v2 with a `snapshots` store; a client `loadSnapshot()` restores from local cache → else server+blobs.

### Why This Day
- Requires: **Day 7** (server load), **Day 3** (file shape). (≤2 ✓)
- Enables: Day 9 (wire into loadChat), Day 11 (offline reads).
- Ordering evidence: restore consumes Day 7 output; mount consumes Day 3 shape.

### Pre-Conditions
- [ ] Days 3 & 7 merged.
- [ ] `pnpm test` passes.
- [ ] **Read `db.ts:14-42`** — confirm the single-store `onupgradeneeded` to extend safely.

### Detailed Steps
#### Step 8.1: Bump IndexedDB to version 2
- **What:** in `app/lib/persistence/db.ts`, change `indexedDB.open('boltHistory', 1)` → `2` and add `if (oldVersion < 2) db.createObjectStore('snapshots', {keyPath:'chatId'})` in `onupgradeneeded` (preserve existing `chats` creation guarded by `oldVersion<1`).
- **Why:** `:540-555, 803`.
- **Current state:** `db.ts:21-31` opens v1, creates only `chats`.
- **Target:** v2 with both stores; **must not** drop `chats`.
- **What could break:** **HIGH RISK** — a botched upgrade can corrupt existing users' `chats` store (data loss of local chat history). Mitigation: keep the `oldVersion<1` guard intact; test upgrade path from a seeded v1 DB.
- **Verification:** open app with a pre-existing v1 DB → chats still present AND `snapshots` store exists (DevTools → Application → IndexedDB).

#### Step 8.2: `app/lib/snapshots/loadSnapshot.ts`
- **What:** read `snapshots/{chatId}` from IndexedDB; if present return files; else fetch Day 7 endpoint, download blobs, reconstruct, write back to IndexedDB.
- **Why:** `:400-422, 805`, abstraction `:878-885`.
- **Verification:** integration Day 9.

### Post-Conditions
- [ ] Existing v1 chat history survives the upgrade (explicit test).
- [ ] `snapshots` store readable/writable.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(snapshots): IndexedDB v2 + client restore`.

### Rollback Plan
1. `git revert HEAD`. **Caveat:** users who already upgraded to v2 stay at v2 (IndexedDB can't downgrade) — but the extra store is inert if unused. Document this as non-destructive.

### Red Flags — Stop if:
- Any test or manual check shows `chats` data missing after upgrade → STOP immediately; this is the single most dangerous change in the plan.

---

## Day 9: Wire snapshot save + restore into the real flow (flag-gated)

### Goal
With `VITE_SNAPSHOTS_ENABLED=true`, saving a chat also saves a version; loading a chat restores from snapshot and suppresses message replay via a guard.

### Why This Day
- Requires: **Day 6/7/8** (save/load/cache). (>2 prior days — JUSTIFIED EXCEPTION: this is the single integration day that necessarily joins the parallel tracks; each input was independently shipped & reversible.)
- Enables: Phase-1 acceptance test; Day 10 offline build on this.
- Ordering evidence: consumes save (6), load (7), cache+mount (8).

### Pre-Conditions
- [ ] Days 6,7,8 merged; flag currently off in prod.
- [ ] `pnpm test` passes.
- [ ] **Read `action-runner.ts` and `workbench.ts`** to locate the action execution method to guard. Doc calls it `_runAction()`/`#restoredFromSnapshot` (`:806`); **confirm the real name** — NEEDS INVESTIGATION until read.

### Detailed Steps
#### Step 9.1: Save wiring
- **What:** in `useChatHistory.ts:178-238` `storeMessageHistory`, after the existing Postgres POST, if flag on: `buildSnapshot()` → dedup → upload missing → POST version → write IndexedDB `snapshots`. Debounce 3s (`:953`).
- **Why:** `:804`.
- **Current state:** `useChatHistory.ts:207-237` already dual-writes; we append, never replace.
- **What could break:** snapshot failure must NOT break chat save → wrap in try/catch that only warns (mirror `:234-236`).
- **Verification:** generate project → row appears in `codebase_versions` + blobs in bucket.

#### Step 9.2: Restore wiring + replay guard
- **What:** in `loadChat()` (`useChatHistory.ts:70-134`), if flag on, call `loadSnapshot(chatId)`; on success set the restore guard so `action-runner` skips shell/file replay.
- **Why:** `:805-806`.
- **What could break:** if guard is wrong, replay runs on top of restore → duplicate file writes. Mitigated by confirming the method name (pre-cond) + test.
- **Verification:** generate → refresh with flag on → IDE shows files, terminal shows only `npm install`/dev (no boltAction replay).

### Post-Conditions
- [ ] Flag OFF → identical to today (proves zero-regression default).
- [ ] Flag ON → generate→refresh restores instantly, no replay; second identical project dedups all blobs.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(snapshots): wire save+restore behind flag`.

### Rollback Plan
1. Set flag off (instant kill-switch, no deploy).
2. If needed `git revert HEAD` — earlier days remain intact and inert.

### Red Flags — Stop if:
- Replay still runs after restore (duplicate writes) → guard wrong.
- Chat save breaks when snapshot fails → try/catch wrong; chat save MUST be independent.

---

## Day 10: Offline outbox — `pendingWrites` store + enqueue on failure (flag-gated)

### Goal
IndexedDB gains `pendingWrites` (v3); failed version saves enqueue instead of being lost.

### Why This Day
- Requires: **Day 8** (IndexedDB upgrade pattern), **Day 9** (save path to wrap).
- Enables: Day 11 (drain), Day 12 (UI).
- Ordering evidence: enqueue wraps Day 9's save; drain (Day 11) reads this store.

### Pre-Conditions
- [ ] Day 9 merged; `pnpm test` passes.

### Detailed Steps
#### Step 10.1: IndexedDB v3
- **What:** bump to version `3`, add `if(oldVersion<3) createObjectStore('pendingWrites',{keyPath:'id',autoIncrement:true})`. Keep v1/v2 guards.
- **Why:** `:550-553, 812`.
- **What could break:** same upgrade-safety risk as Day 8 — keep prior guards; test from seeded v2 DB.
- **Verification:** store exists; `chats`+`snapshots` survive.

#### Step 10.2: `queueWrite()` on save failure
- **What:** in the Day 9 save path, on server failure call `queueWrite('version', chatId, payload)` (`:563-574`).
- **Why:** outbox pattern `:557-559`.
- **Verification:** kill server → save → row appears in `pendingWrites`.

### Post-Conditions
- [ ] Server down → write queued, IDE keeps working.
- [ ] `chats`/`snapshots` intact after v3 upgrade.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(offline): pendingWrites outbox enqueue`.

### Rollback Plan
1. Flag off; `git revert HEAD` if needed (inert store).

### Red Flags — Stop if:
- IndexedDB upgrade loses data (see Day 8 red flag).

---

## Day 11: Drain queue + persisted circuit breaker

### Goal
On reconnect, queued writes drain in timestamp order; a `localStorage`-persisted circuit breaker stops hammering a down server.

### Why This Day
- Requires: **Day 10** (queue exists).
- Enables: Day 12 (UI reflects circuit state).
- Ordering evidence: drain reads Day 10's store.

### Pre-Conditions
- [ ] Day 10 merged; `pnpm test` passes.

### Detailed Steps
#### Step 11.1: `ServerCircuit` (localStorage-persisted)
- **What:** implement class from `:606-669` verbatim (threshold 3, recovery 30s, persisted).
- **Why:** `:599-603, 813`. Doc explicitly rejects in-memory (`:981`).
- **What could break:** corrupt `localStorage` JSON → wrap parse in try/catch.
- **Verification:** 3 failures → `isOpen` true; reload page → still open (persisted).

#### Step 11.2: `drainPendingWrites()`
- **What:** implement `:577-591`; trigger on `navigator.onLine`, post-recovery health check, and page load (`:593-597`).
- **Why:** `:815`.
- **Verification:** queue 2 writes offline → restart server → both reach server, store empties.

### Post-Conditions
- [ ] Circuit opens after 3 fails, survives refresh, half-opens after 30s.
- [ ] Queue drains in order on reconnect.
- [ ] `pnpm test` passes (unit-test the circuit state machine).
- [ ] Committed: `feat(offline): drain + persisted circuit breaker`.

### Rollback Plan
1. `git revert HEAD`. Queue persists harmlessly; drain simply won't run.

### Red Flags — Stop if:
- Drain double-submits (no delete after success) → data dup risk.

---

## Day 12: Offline UI status (banner/indicator)

### Goal
User sees offline/syncing/online state; chat input disabled offline, IDE editing stays enabled.

### Why This Day
- Requires: **Day 11** (circuit state to read). (1 prior ✓)
- Enables: Phase-2 acceptance.
- Ordering evidence: UI subscribes to circuit/queue state from Day 11.

### Pre-Conditions
- [ ] Day 11 merged; `pnpm test` passes.

### Detailed Steps
#### Step 12.1: Status component
- **What:** amber "Working offline — edits save locally" when open; green when restored+drained; disable chat input only (`:674-680`).
- **Why:** `:672-680, 816`.
- **Current state:** integrate into existing chat header (confirm component in pre-cond).
- **What could break:** disabling too much (IDE/preview must stay live — they're browser-only). 
- **Verification:** kill server → amber + input disabled + editor works; restore → green.

### Post-Conditions
- [ ] Correct three states; IDE never blocked offline.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(offline): connection status UI`.

### Rollback Plan
1. `git revert HEAD` (presentational only).

### Red Flags — Stop if:
- Preview/terminal get disabled offline (contradicts `:677`).

---

## Day 13: Wire the existing compiled server (`server.js`) — build path only

### Goal
A production image that runs `node server.js` over `build/server/index.js` exists **alongside** the current dev-server image (no switch yet).

### Why This Day
- Requires: nothing in this plan (independent track).
- Enables: Day 14 (switch compose).
- Ordering evidence: Day 14 flips the command to what Day 13 proves builds.

### Pre-Conditions
- [ ] `pnpm run build` succeeds; `ls build/server/index.js` exists.
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 13.1: New Dockerfile target `bolt-ai-prod-node`
- **What:** add a target that `RUN pnpm run build` then `CMD ["node","server.js"]` (do NOT modify existing `bolt-ai-production`).
- **Why:** `ARCHITECTURE-v2.md:825` "Create production Dockerfile: `remix vite:build` → `node build/server/index.js`".
- **Current state:** `server.js:8` imports `./build/server/index.js`; sets COEP/COOP (`:16-18`). `Dockerfile:64` currently `CMD pnpm run dockerstart` (unchanged).
- **Source 3 (dependency check):** `server.js` is referenced by **no** compose/Dockerfile today (proven) → adding a target that uses it touches nothing existing.
- **What could break:** `build/server/index.js` path/exports mismatch → server boots empty. Mitigated by smoke test.
- **Verification:** `docker build --target bolt-ai-prod-node` → run → `curl localhost:5173/api/health` 200; COEP header present (`curl -I`).

### Post-Conditions
- [ ] New image serves the app via compiled server; old image still builds.
- [ ] WebContainer headers present (`Cross-Origin-Embedder-Policy: require-corp`).
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(runtime): compiled Node server image (additive target)`.

### Rollback Plan
1. `git revert HEAD`. Old image untouched throughout.

### Red Flags — Stop if:
- `/api/health` 200 but app HTML missing → Remix build wiring wrong; do NOT proceed to Day 14.

---

## Day 14: Switch one prod compose service to the compiled server (reversible)

### Goal
`docker-compose.prod.yaml` app service runs the compiled server; Vite is build-time only at runtime.

### Why This Day
- Requires: **Day 13** (proven image).
- Enables: removes Vite-dev-in-prod (doc Phase 3 core).
- Ordering evidence: flips command to Day 13's verified target.

### Pre-Conditions
- [ ] Day 13 merged & smoke-tested.
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 14.1: Change command + build target
- **What:** in `docker-compose.prod.yaml`, change app `target` to `bolt-ai-prod-node` and `command:` from `pnpm run dev --host 0.0.0.0` (`:129`) to `node server.js`.
- **Why:** `:826` "Switch from `pnpm run dev` to production server in docker-compose".
- **Current state:** `docker-compose.prod.yaml:129` runs the Vite dev server in prod (also flagged by doc `:26`).
- **What could break:** HMR/websocket envs (`:104-109`) become irrelevant; nginx websocket proxy still fine. Port 5173 unchanged.
- **Verification:** `docker compose -f docker-compose.prod.yaml --profile production up` → app served, `/api/health` 200, a generated project still runs in WebContainer (COEP intact via `server.js` + `nginx-ecs.conf:138-147`).

### Post-Conditions
- [ ] Prod serves via `node server.js`; no `vite` process in the container (`docker exec ... ps`).
- [ ] End-to-end: login → generate → WebContainer boots.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(runtime): run prod via compiled server (no Vite at runtime)`.

### Rollback Plan
1. Revert the compose hunk (one commit) → back to `pnpm run dev`. Image from Day 13 still present.
2. Verify: prod boots on dev-server command again.

### Red Flags — Stop if:
- WebContainer fails to boot in prod (missing COEP/COOP) → revert immediately; headers regressed.

---

## Day 15: Version listing API + DB function

### Goal
`GET /api/chats/:id/versions` returns the last 50 versions' metadata.

### Why This Day
- Requires: **Day 6** (rows exist).
- Enables: Day 16/17 (UI panel).
- Ordering evidence: lists what Day 6 writes.

### Pre-Conditions
- [ ] Day 6 merged; at least one chat has versions.
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 15.1: Route + `listCodebaseVersionsPostgres()`
- **What:** `SELECT version_number, description, file_count, total_bytes, created_at ... ORDER BY version_number DESC LIMIT 50` (`:453-458`). Ownership-checked.
- **Why:** `:450-458, 849`.
- **Current state:** mirror read-fn style of `getChatsByUserPostgres` (`:1477-1518`).
- **What could break:** missing ownership filter → cross-user listing. Reuse access check.
- **Verification:** `curl /api/chats/<id>/versions` → ordered array.

### Post-Conditions
- [ ] Returns ordered metadata; other users get empty/403.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(versions): list endpoint`.

### Rollback Plan
1. `git revert HEAD` (read-only route).

### Red Flags — Stop if:
- Another user can list versions of a chat they don't own.

---

## Day 16: Rollback API (transactional, creates new version)

### Goal
`POST /api/chats/:id/rollback?version=N` creates a NEW latest version copying old manifest.

### Why This Day
- Requires: **Day 6** (version rows + ref_count), **Day 15** (a version to pick). 
- Enables: Day 17 (button).
- Ordering evidence: copies a row Day 6 created; bumps ref_count Day 6 manages.

### Pre-Conditions
- [ ] Days 6 & 15 merged; `pnpm test` passes.

### Detailed Steps
#### Step 16.1: Route + `rollbackCodebaseVersionPostgres()`
- **What:** transaction from `:464-494` (lock, unmark latest, INSERT copy as new max version, bump ref_count via `jsonb_each_text`).
- **Why:** `:461-497, 850`. "Rollback creates a new version" rationale `:497`.
- **What could break:** if not transactional, concurrent rollback+save corrupts `is_latest`. Same `FOR UPDATE` lock pattern as Day 6.
- **Verification:** v1→v2→v3, rollback to v1 → a v4 created with v1's manifest; one `is_latest`.

### Post-Conditions
- [ ] Rollback = append (history immutable); ref_counts correct.
- [ ] `pnpm test` passes (transaction test).
- [ ] Committed: `feat(versions): transactional rollback`.

### Rollback Plan
1. `git revert HEAD`. No history mutated (append-only by design).

### Red Flags — Stop if:
- Rollback UPDATEs/deletes an existing manifest (must be append-only).

---

## Day 17: Version history UI panel + Restore button

### Goal
IDE sidebar lists versions; "Restore this version" calls rollback then remounts.

### Why This Day
- Requires: **Day 15** (list), **Day 16** (rollback).
- Enables: Phase-5 acceptance.
- Ordering evidence: UI consumes both endpoints.

### Pre-Conditions
- [ ] Days 15 & 16 merged; `pnpm test` passes.

### Detailed Steps
#### Step 17.1: Panel component
- **What:** list (timestamp, description, file_count); Restore button → `POST rollback` → `loadSnapshot()` remount (Day 8).
- **Why:** `:851-852`.
- **Current state:** add to existing workbench sidebar (confirm host component in pre-cond).
- **What could break:** remount path reuses Day 8/9 restore — if flag off, hide panel.
- **Verification:** the doc's Phase-5 test (`:854`): v1→v2→v3→rollback v1→IDE shows v1→v4 exists.

### Post-Conditions
- [ ] Panel lists versions; restore works visually + creates new version.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(versions): history panel + restore`.

### Rollback Plan
1. `git revert HEAD` (presentational; APIs remain).

### Red Flags — Stop if:
- Restore mutates history instead of appending.

---

## Day 18: GC job (prune versions, ref_count, orphan blobs) in cron container

### Goal
A nightly script prunes versions beyond 30/chat, decrements ref_count, deletes orphan blobs from DB and object storage.

### Why This Day
- Requires: **Day 6** (ref_count semantics), **Day 1** (delete from storage).
- Enables: bounded growth.
- Ordering evidence: GC reverses Day 6's ref_count increments; deletes Day 5's uploads.

### Pre-Conditions
- [ ] Days 1 & 6 merged; cron container present (`docker-compose.prod.yaml:132-150`).
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 18.1: GC endpoint/script
- **What:** implement `:504-526` steps (delete versions rn>30; decrement ref_count; `DELETE FROM codebase_blobs WHERE ref_count<=0`; delete those keys from storage). Guard with `CRON_SECRET` (existing pattern: `docker-compose.prod.yaml:147` cron posts with Bearer).
- **Why:** `:499-526, 858-860`.
- **Current state:** reuse cron auth pattern of `api.cron.sleep-check.ts`.
- **What could break:** **deleting referenced blobs** if ref_count logic is off → data loss. Mitigate: delete from storage only AFTER DB delete confirms ref_count<=0, in a dry-run-first mode (log keys before deleting for the first run).
- **Verification:** seed >30 versions → run → exactly 30 remain; a blob referenced elsewhere is NOT deleted.

### Post-Conditions
- [ ] Versions capped at 30/chat; shared blobs survive; orphans gone.
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(gc): snapshot retention + orphan blob cleanup`.

### Rollback Plan
1. Remove the cron schedule entry (stop running it) / `git revert HEAD`. **Note:** deletions are irreversible — that's why Day 18 ships dry-run-first.

### Red Flags — Stop if:
- Dry-run lists a blob you can prove is still referenced → ref_count logic broken; do NOT enable real deletion.

---

## Day 19: Monitoring + alerts

### Goal
Operational visibility: table sizes, pool wait, disk alerts.

### Why This Day
- Requires: Days 2,6 (tables to measure). (≤2 ✓)
- Enables: safe operation at scale.
- Ordering evidence: measures objects created earlier.

### Pre-Conditions
- [ ] `pnpm test` passes.

### Detailed Steps
#### Step 19.1: Metrics
- **What:** add `pg_total_relation_size('codebase_versions')` + blob count to `/api/health` (or a new `/api/metrics`); document disk/pool alert thresholds.
- **Why:** `:832, 861-862`.
- **Current state:** extend existing `app/routes/api.health.ts`.
- **What could break:** exposing metrics unauthenticated → gate behind `CRON_SECRET`/admin.
- **Verification:** endpoint returns sizes; alert doc committed.

### Post-Conditions
- [ ] Metrics reachable (authorized only).
- [ ] `pnpm test` passes.
- [ ] Committed: `feat(ops): snapshot/storage metrics`.

### Rollback Plan
1. `git revert HEAD`.

### Red Flags — Stop if:
- Metrics leak without auth.

---

## Day 20: End-to-end hardening, flag flip decision, buffer

### Goal
Full acceptance pass; decide whether to default `SNAPSHOTS_ENABLED=true`.

### Why This Day
- Requires: all prior days.
- Enables: go/no-go.

### Pre-Conditions
- [ ] Days 1-19 merged; `pnpm test` passes; prod runs compiled server (Day 14).

### Detailed Steps
#### Step 20.1: Run every doc acceptance test
- **What:** execute Phase-1 test (`:808`), Phase-2 test (`:819`), Phase-5 test (`:854`); plus failure-scenario spot checks from `:942-954` (PG down → offline; concurrent saves → no loss).
- **Verification:** all pass; record results in this file's changelog.

#### Step 20.2: Flag decision
- **What:** if all green for 24-48h with flag on in staging, set default on. Otherwise keep off (ships safe).
- **What could break:** turning on globally surfaces the Day-8 IndexedDB-upgrade risk for real users → stagger rollout.

### Post-Conditions
- [ ] All acceptance tests pass; decision recorded.
- [ ] `pnpm test` passes; final commit.

### Rollback Plan
1. Flag off (global kill-switch) — no deploy needed.

### Red Flags — Stop if:
- Any failure scenario loses data → keep flag off, do not ship.

---

## Section 4: Integration Checkpoints

**End of Week 1 (Day 5):** storage abstraction + both tables + buildSnapshot + dedup + presigned upload exist, all flag-gated, system behaves exactly as today with flag off. *Verify:* `pnpm test`; flag-off app identical; blob PUT to bucket works via curl.

**End of Week 2 (Day 10):** full snapshot save+restore wired behind flag; IndexedDB at v2/v3 without losing `chats`; outbox enqueues on failure. *Verify:* generate→refresh restores with no replay (flag on); seeded v1 DB upgrades without data loss; kill server → write queued.

**End of Week 3 (Day 15):** offline UX complete; prod runs the compiled server (no Vite at runtime); version listing API live. *Verify:* offline banner + IDE still editable; `docker exec ... ps` shows no `vite`; `/api/health` 200; `/versions` returns data.

**End of Week 4 (Day 20):** version history UI + rollback + GC + monitoring; all doc acceptance tests pass. *Verify:* full v1→v3→rollback flow; GC caps at 30 keeping shared blobs; metrics authorized-only; data-safety scenarios pass.

---

## Section 5: Risk Register

| # | Risk | Likelihood (evidence) | Impact | Mitigation in plan | If mitigation fails |
|---|---|---|---|---|---|
| R1 | IndexedDB v1→v2/v3 upgrade corrupts `chats` (local history loss) | Med — `db.ts:21-31` upgrade is non-trivial | High (user data loss) | Day 8/10 keep `oldVersion<N` guards; test from seeded DBs; revert is non-destructive | Ship flag-off; hotfix upgrade; users re-sync from Postgres `chats` |
| R2 | Presigned URLs fail on Huawei OBS / GCS (signature/region) | Med — not yet tested; only S3-on-R2 in doc | High (snapshots unusable) | Days 5/7 gate before proceeding; S3 abstraction isolates config | Fall back to direct server upload/download (no presign) |
| R3 | GC deletes a still-referenced blob | Low-Med — ref_count logic new | High (silent file loss) | Day 18 dry-run-first; delete storage only after DB confirms ref_count<=0 | Restore from object-storage versioning/backup; rebuild ref_counts from manifests |
| R4 | Replay-suppression guard wrong → duplicate file writes on restore | Med — guard name unconfirmed (`:806`) | Med (corrupted restore) | Day 9 confirms method name first; acceptance test for no-replay | Revert Day 9; flag off |
| R5 | Compiled-server prod loses WebContainer COEP headers | Low — `server.js:16-18` sets them | High (core feature dead) | Day 13/14 `curl -I` header check + e2e WebContainer boot | Revert compose hunk to dev-server |
| R6 | "All tests pass" gives false confidence | High — only 3 unrelated specs | Med (regressions slip) | Characterization tests per touched area + scripted manual checks | Treat manual checks as the real gate |
| R7 | 20 days insufficient for doc's 21-29 | High — doc `:864` | Med (scope) | Phase 4 + scaling deferred (Section 6) with justification | Extend timeline or cut Phase 5 UI |
| R8 | Concurrent-save race drops a version | Low — if `FOR UPDATE` applied | Med | Days 6/16 use the doc's `FOR UPDATE` lock (`:388-392`) | Add app-level mutex; retry on unique-violation |
| R9 | `init-db.sql` latent `projects` ordering bug surfaces on fresh init | Med — `init-db.sql:355` ALTERs uncreated table | Med (fresh deploy fails) | Day 2 adds tables only with `chats`/`users` FKs; flag the pre-existing bug | Fix `init-db.sql` projects ordering separately |

---

## Section 6: Things I Am NOT Confident About

**Fewer than 3 sources / unverified from code alone:**
1. **Exact file-map accessor in WorkbenchStore** (Day 3) and **the replay method name `_runAction`/`#restoredFromSnapshot`** (Day 9). Doc asserts them (`:806`); I confirmed the files exist but **have not read the exact members**. → Each is a Day-of "read first" pre-condition, marked NEEDS INVESTIGATION.
2. **`api.deploy.ts:114-137` env-config lines** (doc `:27,704`). File exists; exact lines unverified. Only matters for the **deferred** Phase 4.
3. **Presigned-URL behavior on Huawei OBS / GCS** (R2). External-service assumption; the doc only verifies R2. R2/Risk R2.

**Depends on library/service behavior not provable from this repo:**
4. **`@aws-sdk/client-s3` against non-AWS endpoints** (Huawei OBS path-style/region quirks).
5. **IndexedDB upgrade atomicity** across browsers (doc cites MDN `:442`, but real upgrade safety is per-browser).

**Contradicts something in the codebase (flagged, resolved):**
6. **Doc says R2 "already implemented" (`:870`)** — false; built greenfield, S3-abstracted, provider = your Huawei/GCP target.
7. **Doc `auth.ts` path (`:30`)** — real path `app/lib/auth.ts`.
8. **Doc Phase 3 "create production Dockerfile" (`:825`)** — a usable `server.js` already exists; plan wires it instead of writing new.

**Explicitly excluded from these 20 days (justified):**
9. **Phase 4** (Remix data proxy, data API token, RLS, Supabase migration) — doc `:757` "cost optimization, not a reliability fix"; 5-7 days `:834`; security-sensitive.
10. **Phase 3 scaling** (PgBouncer, read replica, multi-replica) — doc marks "at 1,000+ users" `:59,774`.

---

## Self-Audit (performed before saving)

- **Every doc requirement mapped?** Phases 1 (Days 1-9), 2 (10-12), 3-runtime (13-14), 5 (15-17), 6 (18-19) covered; Phase 4 + scaling **explicitly deferred with reasons** (Section 6). ✔ with documented exclusions.
- **Anything changed the doc didn't ask for?** The S3-abstraction (vs hard R2) — justified by doc Part 10 + your deployment target; flagged. Wiring `server.js` vs new Dockerfile — justified by existing code. No other additions.
- **Per-day failure ⇒ revert to prior working state?** Every day is additive/flag-gated; Day 9/14 are the integration days and both have instant kill-switches (flag / compose revert). ✔
- **Phantom dependencies?** Checked via `git cat-file`: all referenced files exist on EulerOS; the two unread internals (WorkbenchStore map, replay guard) are marked NEEDS INVESTIGATION rather than assumed. ✔
- **Scope creep?** Each step ties to a doc line; no "nice to haves." ✔
- **Weakest day / riskiest assumption (adversarial read):** **Day 8** (IndexedDB upgrade, R1) and **Day 5/7** (presigned URLs on non-R2, R2). Both carry explicit STOP red flags.
