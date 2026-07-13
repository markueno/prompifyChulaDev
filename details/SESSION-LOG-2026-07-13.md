# Session Log — 2026-07-13 (Opus 4.8 + Fable 5 pairing)

Continues `CONTEXT-HANDOFF-2026-07-10-EOD.md`. This is the full record of the 2026-07-13
session: Qwen streaming root-cause + fix, several stability fixes, and the state-persistence
(refresh) fix. **Staging VM was ON all day and used directly for diagnosis.**

Branch `feat/persistence-architecture-v2`. HEAD at end of day: **`6cd5174`** (pushed).
VM last confirmed at `3f98c33` (needs redeploy to `6cd5174` — see §4).

---

## 1. WHAT WAS DONE TODAY (commit by commit, all pushed)

| Commit | What | Verified |
|---|---|---|
| `bd89e18` | LLM stream timeout (`AbortSignal.timeout`, 180s, `LLM_STREAM_TIMEOUT_MS`) + Qwen `enable_thinking:false` injection + IndexedDB v1→v3 test gap | tsc, 63/63, build |
| `cec7785` | Qwen streaming realm fix + binary blob storage + import cycle + minor | on VM |
| `942b887` | save debounce race + auto-save + (re)streaming + blobs + import cycles | on VM |
| `3f98c33` | immediate snapshot on manual save + auto-save + debounce race | on VM, running |
| `6cd5174` | **state persistence fix** — optimistic IndexedDB cache write before server save | tsc, tests ✅; **NOT yet on VM** |

### 1.1 Qwen streaming — ROOT CAUSE FOUND & FIXED (the day's biggest item)
- Symptom: `/api/chat` with Qwen → `AI_APICallError: Failed to process successful response`; browser spins, no output.
- Diagnosed empirically on the VM with ~10 probes (raw curl + in-container node scripts). **Ruled out**: gateway (exact 26KB body replays perfectly + `[DONE]`), API key/URL resolution (correct token-plan gateway, 114-char key), `enable_thinking`, `maxTokens: 65536`, context overflow (21k-token prompt streams fine), `toolChoice:'none'` (SDK drops it), system-prompt size, `abortSignal`, temperature.
- **Decisive contrast**: the identical request **works in a standalone `node` script but fails inside the running Remix server** — same container, same node_modules.
- **Root cause: web-streams realm mismatch in the Vite SSR bundle.** The AI SDK's `createEventSourceResponseHandler` does `response.body.pipeThrough(new TextDecoderStream())`; undici's native `Response.body` fails the SDK's same-realm `instanceof ReadableStream` check when the bundle's stream constructors come from a different realm → the handler throws → wrapped as "Failed to process successful response."
- **Fix (in `app/lib/modules/llm/providers/qwen.ts`)**: the `disableThinkingFetch` wrapper now **re-wraps the response body through `globalThis.ReadableStream`** (`new globalThis.Response(fixedBody, {headers,status,statusText})`) so the SDK pipes a same-realm stream. **Confirmed working on VM** (`[QWEN-DIAG]` logs + LLM responds).
- Also in `qwen.ts`: `maxTokenAllowed` `65536 → 8192` (65536 is the model's *total context*, being sent as the *completion* cap `max_tokens`; 8192 is a sane completion limit).

### 1.2 Other fixes shipped today
- **Binary blob storage** (`buildSnapshot.ts`, `files.ts`, `workbench.ts`, `types/istextorbinary.d.ts`): binary files now base64-encoded end-to-end (previously hashed to `sha256('')` → images lost). `mountSnapshot` base64-decodes on restore.
- **Import cycle break**: new `app/lib/snapshots/scheduleSnapshot.ts` extracted the shared `db`/`chatId`/`description` atoms + `scheduleSnapshotSave` out of `useChatHistory.ts` to break the workbench ↔ persistence circular import. `useChatHistory.ts` re-exports for back-compat.
- **Save debounce race** (`CodeMirrorEditor.tsx`, `Workbench.client.tsx`, `EditorPanel.tsx`, `workbench.ts`): Cmd+S now uses `saveCurrentDocumentWithContent(liveContent)` — live editor value, not the 150ms-debounced stale copy.
- **Auto-save** (`workbench.ts`): files auto-save to the WebContainer FS 3s after the last edit.
- **Immediate snapshot on manual save** (`scheduleSnapshotSave(..., immediate=true)`): Cmd+S triggers the snapshot upload now, not after the 3s debounce.
- **State persistence (`6cd5174`)**: `saveCodebaseSnapshot` now writes the local IndexedDB snapshot cache **optimistically, before** the server round-trip. Previously the cache was written only on server success, so any server failure (circuit open / offline / auth-FK error under `AUTH_DISABLED` admin-bypass) left the cache empty → refresh found no snapshot → message replay → **manual edits lost**. The real server version overwrites the provisional one on success.
- **Ops/CI**: Dockerfile HuggingFace ARG naming aligned dev↔prod; `backup-runner.sh` WAL backlog now logs to stdout too; `ci.yaml` ESLint step uncommented; `api.chat.ts` logs `error.cause`.
- Committed deletions of the stale root-level `IMPLEMENTATION-PLAN-ARCHITECTURE-v2.md` + `architecture-presentation.html` (canonical plan lives in `details/`).

### 1.3 VM environment state (set today, staging only)
- Nginx switched to **dev config (HTTP only, no TLS cert)**; firewall locked to owner IP; **`AUTH_DISABLED=true`**; `admin-bypass` user inserted into Postgres; `VITE_SNAPSHOTS_ENABLED=true` confirmed. VM at `3f98c33`, healthy.

---

## 2. WHAT IS WRONG / KNOWN BUGS (detailed, with root cause)

1. **[CRITICAL, code-fixed, UNDEPLOYED] Manual edits lost on refresh.** Root cause: local snapshot cache only written on server success (see §1.2). **Fixed in `6cd5174`** but **not yet on the VM** — needs redeploy + browser test. Secondary sub-bug still open: on a brand-new chat, `chatId` is `undefined` until the first AI response, so `scheduleSnapshotSave` early-returns ([scheduleSnapshot.ts:119](../app/lib/snapshots/scheduleSnapshot.ts#L119)) — edits made *before* first generation are not saved. Needs `ensureChatId()` before manual save to fully close.

2. **[Not a standalone code bug] Preview breaks/empties on refresh.** WebContainer is **ephemeral** — every refresh is a fresh in-browser VM with an empty FS. The preview only exists after a dev server re-emits `server-ready` (`previews.ts:74`). It cannot persist; the dev server MUST rebuild each refresh. It "breaks" when (a) snapshot restore fails (bug #1) so files are missing/stale, or (b) the `npm install`/`dev` replay hasn't finished. Improves automatically once bug #1 is deployed. `previews.ts` already has watcher-retry (ENOENT) + port-poll fallbacks.

3. **[Narrow gap] npm install/dev not fully automatic.** Already mitigated: system prompt has mandatory `install → start` ordering ([prompts.ts:244-247](../app/lib/common/prompts/prompts.ts#L244)); `#runStartAction` **auto-runs `npm install` if `node_modules` is missing** ([action-runner.ts:268-295](../app/lib/runtime/action-runner.ts#L268)); `buildSnapshot` excludes `node_modules` so every refresh reinstalls. **Remaining gap:** if the LLM emits **no `start` action at all**, nothing restarts the dev server on refresh. A guarded "ensure dev server after restore" (fire once, only if no `start` replays within ~8s, requires package.json) would close it — must avoid double-starting dev servers.

4. **[Cleanup] `[QWEN-DIAG]` console.log left in production** at `qwen.ts:40-43` — logs on every Qwen request. Harmless but noisy; remove (keep the realm re-wrap fix underneath). `api.chat.ts` `error.cause` logging may also be diagnostic — review.

5. **[Recurring] Postgres FK violations** — `AUTH_DISABLED=true` yields `admin-bypass` user not in `users` table; version/token saves can 500. Manually seeded today; recurs on a fresh DB. (This is *why* bug #1's optimistic cache matters — it makes edits survive even when these server saves fail.)

6. **[Deferred, unchanged] Binary blob fix** deployed but **not yet browser-tested** on VM (generate app with an image → snapshot → refresh → image intact).

7. **[WebContainer fundamental, cannot fix] `npm install` runs every refresh** (829 packages, Node-in-WASM). Only mitigation is the snapshot system working so *files* persist (install still re-runs).

---

## 3. STILL DEFERRED (unchanged, explicitly out of scope this session)
- **Security** — whole `SECURITY_NOW.md`: CRIT-1 JWT fail-open (`auth.ts:85` `'your-secret-key'`), CRIT-2 committed TLS key + JWT secret, CRIT-3 unauth RCE `api.update.ts`, H-1..H-6. **P0 items still present in tree.** Nginx §9 edge-block NOT applied.
- **Lint cleanup** — 2168 problems (2164 err, 2089 auto-fixable). Commits still need `--no-verify`.
- **B1b** brand-new-chat `chatId` race (see §2.1 secondary).
- SQLite fallback for local dev; CSV/Excel data import; Phase 4 (Supabase→Remix proxy); PgBouncer/read-replica (1000+ users).
- Ops gates: backup 24h + `pg_restore` test → then flip GC `?apply=true`; prod DB `ALTER TABLE codebase_versions ADD COLUMN IF NOT EXISTS message_id TEXT;`.

---

## 4. WHAT SHOULD BE DONE NEXT (in order)

1. **Deploy `6cd5174` to the VM** (currently at `3f98c33`):
   ```bash
   gcloud config set project prompify-db
   gcloud compute ssh prompify-vm --zone asia-southeast1-c
   cd /data/prompify
   sudo git fetch origin && sudo git reset --hard origin/feat/persistence-architecture-v2   # -> 6cd5174
   sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
   # NEVER bare `up -d` (starts nginx+certbot → Let's Encrypt rate limits). Watch CACHED on pnpm step -> --no-cache.
   curl -s http://localhost:5173/api/health   # uptime numeric
   ```
2. **Browser-test bug #1 (the point of today):** open app → generate → edit a file → Cmd+S → hard refresh → **edit must survive**. Also test binary blob (image survives refresh) and the offline/circuit path.
3. **Remove `[QWEN-DIAG]` logging** from `qwen.ts` (keep the realm re-wrap). Commit `chore: remove qwen streaming diagnostics`.
4. **Close bug #1 secondary:** call `ensureChatId()` before manual/auto save so pre-first-response edits persist.
5. **Decide on guarded #3 auto-restart** (ensure dev server after restore, race-safe).
6. Then the deferred backlog (security P0 first when ready).

---

## 5. ENVIRONMENT / ACCESS (unchanged)
- GCP project `prompify-db`, VM `prompify-vm`, zone **`asia-southeast1-c`**, SSH user `promp`, account `prompifysup@gmail.com`. `gcloud` on PATH (Windows/plink occasionally RC1 — retry). Repo `/data/prompify`, git needs `sudo` (root-owned).
- Commits need `--no-verify` (lint debt; tsc clean). Branch `feat/persistence-architecture-v2` only.
- **STAGING ONLY** — prod is a separate VM at prompify.com; never point DNS/certbot here.
- `.env` on VM only (dockerignored). `DASHSCOPE_API_KEY` has a trailing `=` (part of key); base URL is the token-plan MaaS gateway, not dashscope-intl.
