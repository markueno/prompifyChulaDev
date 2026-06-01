# Prompify

**AI-powered B2B enterprise app suite builder.** Generate, deploy, and manage a suite of internal web applications per company — with shared identity, shared data, governance, and full code ownership.

---

## Table of Contents

- [What is Prompify](#what-is-prompify)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Running with Docker Compose](#running-with-docker-compose)
- [Running Locally (without Docker)](#running-locally-without-docker)
- [Phase 1 — AI App Builder](#phase-1--ai-app-builder)
- [Phase 2 — Multi-Tenant Enterprise](#phase-2--multi-tenant-enterprise)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Available Scripts](#available-scripts)

---

## What is Prompify

Prompify lets enterprise teams build and manage internal web applications using AI — without writing code from scratch. Unlike other AI builders that work at the individual app level, Prompify works at the **company level**: one workspace, multiple apps, shared infrastructure.

**What makes it different from Replit, Lovable, Base44, v0.dev:**

| | Other builders | Prompify |
|---|---|---|
| Unit of value | Individual app | Company app suite |
| Data isolation | Per-app | Per-company (shared schema) |
| Identity | Per-app auth | Company SSO propagated to all apps |
| Code ownership | Platform-dependent | Your GitHub org, standard code |
| Governance | None or bolt-on | RBAC + audit log built in |
| Multi-app dashboard | No | Yes — status, sleep/wake, deploy |

---

## Architecture Overview

```
User (browser)
    │
    ├── Structured Prompt Wizard (6 questions → system prompt)
    │
    ├── AI IDE (WebContainers — Node.js runs in browser via WASM)
    │     ├── Code editor (CodeMirror 6)
    │     ├── Terminal (xterm.js)
    │     └── Live preview (iframe)
    │
    └── Deploy → Netlify (static/SSR) or Docker container (Phase 3)
                      │
                      └── Code pushed to company GitHub org
                                │
                                └── App appears in /c/{company-slug} dashboard
```

**Infrastructure stack (Docker Compose):**

```
nginx (HTTPS, port 443/80)
    └── app (Remix + Vite, port 5173)
          ├── postgres (PostgreSQL 15, port 5432)
          ├── redis (Redis 7, port 6379)
          └── cron (curl-based, hits /api/cron/sleep-check every 15 min)
```

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/) (Windows/Mac) or Docker Engine + Compose (Linux)
- An AI provider API key — at minimum one of: Anthropic, OpenAI, Groq, Google, etc.
- A Netlify account + token (for app deployment in Phase 1)
- A GitHub org (optional, for code push in Phase 2)

---

## Environment Setup

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

### Required variables

```env
# Database (auto-configured in Docker — change only if using external Postgres)
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://prompify_user:Mark@3156@postgres:5432/prompify
POSTGRES_DB=prompify
POSTGRES_USER=prompify_user
POSTGRES_PASSWORD=Mark@3156

# Auth
JWT_SECRET=change-this-to-a-long-random-string-in-production
AUTH_DISABLED=false

# Cron endpoint protection (Phase 2 — sleep/wake)
CRON_SECRET=generate-a-random-string-here

# At least one AI provider
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GROQ_API_KEY=gsk_...
# GOOGLE_GENERATIVE_AI_API_KEY=...
```

### Optional variables

```env
# Email (for verification + password reset)
SENDGRID_API_KEY=
FROM_EMAIL=noreply@yourdomain.com
EMAIL_VERIFICATION_REQUIRED=true

# Other AI providers
OPEN_ROUTER_API_KEY=
XAI_API_KEY=
HuggingFace_API_KEY=
TOGETHER_API_KEY=
OLLAMA_API_BASE_URL=http://host.docker.internal:11434
AWS_BEDROCK_CONFIG=

# Dev/debug
AUTH_DISABLED=true        # Bypass login entirely (local dev only)
VITE_LOG_LEVEL=debug
```

---

## Running with Docker Compose

This is the primary way to run Prompify. It starts PostgreSQL, Redis, Nginx, the app, and the cron runner together.

```bash
docker-compose -f docker-compose.prod.yaml --profile production up --build --force-recreate
```

App is available at:
- `http://localhost:5173` (direct)
- `https://localhost` (via Nginx, if SSL certs are configured)

**Database migrations run automatically** on app start — `createPostgresTables()` runs idempotent `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements every time the app boots.

### Useful Docker commands

```bash
# View logs
docker logs prompify-app -f
docker logs prompify-postgres -f

# Connect to Postgres directly
docker exec -it prompify-postgres psql -U prompify_user -d prompify

# Rebuild after code changes
docker-compose -f docker-compose.prod.yaml --profile production up --build

# Stop everything
docker-compose -f docker-compose.prod.yaml --profile production down

# Stop and wipe the database (fresh start)
docker-compose -f docker-compose.prod.yaml --profile production down -v
```

---

## Running Locally (without Docker)

Requires a running PostgreSQL instance.

```bash
# Install dependencies
pnpm install

# Set DATABASE_URL in .env to point at your local Postgres
# Then start the dev server
pnpm run dev
```

App runs at `http://localhost:5173`.

---

## Phase 1 — AI App Builder

Phase 1 delivers the core generation → deployment loop for a single user.

### How it works

1. **Structured prompt wizard** — answer questions about what you want to build (app type, users, auth, payments). Outputs a structured system prompt.
2. **AI generation** — Claude/GPT streams generated code into a virtual filesystem via WebContainers (Node.js running in-browser via WASM). No remote VM needed during development.
3. **Live preview** — app runs instantly in an iframe inside the IDE.
4. **Deploy** — click Deploy → files packaged → Netlify Sites API → live `*.netlify.app` URL returned.

### Supported AI providers

OpenAI · Anthropic (Claude) · Google Gemini · Groq · Mistral · Cohere · Ollama · LM Studio · OpenRouter · Together · HuggingFace · xAI · AWS Bedrock · DeepSeek · Perplexity

### Configuring API keys

Set keys in your `.env` file **or** enter them directly in the app UI (Settings → Providers). UI-entered keys are stored in the browser only.

### Netlify deployment

In the IDE, click the Deploy button. On first deploy, enter your Netlify personal access token — it's stored in your browser and sent with each deploy request.

---

## Phase 2 — Multi-Tenant Enterprise

Phase 2 introduces company-scoped workspaces. Each company gets isolated data, a GitHub org for code storage, a shared app suite dashboard, RBAC, and an audit log.

### Creating a company workspace

1. Navigate to `/company/new`
2. Enter company name and slug (used in URL: `/c/{slug}`)
3. Optionally enter your GitHub org name (required for code push)
4. You become the company admin automatically

### App suite dashboard

`/c/{slug}` — shows all apps grouped by status (Active → Building → Sleeping → Draft → Failed) with status badges, last-active time, deploy URL, GitHub repo link, and Wake/Sleep actions.

### RBAC roles

| Role | Can do |
|---|---|
| `admin` | All actions + member management + settings |
| `developer` | Build, deploy, wake, sleep apps |
| `viewer` | Read-only — can see dashboard, cannot act |

### GitHub code push

After deploying an app, click "Push to GitHub" to create a private repo in your company's GitHub org and push all generated files. Requires a GitHub PAT with `repo` scope stored in the browser.

Each app gets its own repo: `{github-org}/{app-slug}`.

### Sleep / wake

Apps with `runtime_type = container` (Phase 3) automatically sleep after 15 minutes of inactivity via the cron service. Static/Netlify apps track status only — they don't actually stop since Netlify always serves them.

Manual sleep/wake buttons are on each app card in the dashboard.

### Audit log

Every action (CREATE_COMPANY, DEPLOY, PUSH_CODE, WAKE, SLEEP, MEMBER_ADD, etc.) is logged to the `audit_logs` table. Visible at `/c/{slug}/settings` under the Audit log section.

---

## Database Schema

All tables created automatically on app start. Key tables:

### Core (Phase 1)

| Table | Purpose |
|---|---|
| `users` | Auth credentials, verification, lockout |
| `user_sessions` | JWT session tokens (hashed), expiry |
| `projects` | App container — extended in Phase 2 |
| `project_members` | Per-project RBAC |
| `chats` | AI conversation history (JSONB messages) |
| `token_usage` | Per-message token consumption |
| `token_balances` | Token allocation pools (tier, top-up, promo) |
| `subscriptions` | User subscription tier |

### Multi-tenant (Phase 2)

| Table | Purpose |
|---|---|
| `companies` | Tenant accounts — name, slug, GitHub org, plan |
| `company_members` | Company RBAC (admin / developer / viewer) |
| `audit_logs` | Append-only action log per company |

### Extended `projects` columns (Phase 2)

| Column | Purpose |
|---|---|
| `company_id` | FK → companies |
| `status` | `draft \| building \| active \| sleeping \| failed` |
| `runtime_type` | `static \| worker \| container` |
| `github_repo` | Full GitHub repo URL |
| `deploy_url` | Live app URL |
| `last_active_at` | Used for inactivity sleep threshold |
| `build_logs` | Captured build output |

---

## API Reference

### Auth
| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/login` | Login with email + password |
| POST | `/api/auth/register` | Register new account |
| POST | `/api/auth/logout` | Invalidate session |
| POST | `/api/auth/forgot-password` | Send reset email |
| POST | `/api/auth/reset-password` | Set new password |

### AI & Deployment
| Method | Route | Description |
|---|---|---|
| POST | `/api/chat` | Stream AI code generation (SSE) |
| POST | `/api/deploy` | Deploy to Netlify |
| POST | `/api/github/push` | Push generated files to GitHub org repo |

### Companies (Phase 2)
| Method | Route | Description |
|---|---|---|
| GET | `/api/companies` | List user's companies |
| POST | `/api/companies` | Create company |
| PATCH | `/api/companies` | Update company |
| GET | `/api/companies/:id/members` | List members |
| POST | `/api/companies/:id/members` | Add member |
| PATCH | `/api/companies/:id/members` | Change member role |
| DELETE | `/api/companies/:id/members` | Remove member |

### App Lifecycle (Phase 2)
| Method | Route | Description |
|---|---|---|
| POST | `/api/apps/:id/wake` | Wake a sleeping app |
| POST | `/api/apps/:id/sleep` | Sleep an active app |
| POST | `/api/cron/sleep-check` | Auto-sleep inactive apps (requires `Authorization: Bearer {CRON_SECRET}`) |

### Pages
| Route | Description |
|---|---|
| `/app` | Main AI IDE |
| `/app/overview` | User dashboard (token usage, recent runs) |
| `/company/new` | Create company workspace |
| `/c/:slug` | Company app suite dashboard |
| `/c/:slug/settings` | Company settings, members, audit log |

---

## Available Scripts

```bash
pnpm run dev          # Start development server (localhost:5173)
pnpm run build        # Production build
pnpm run typecheck    # TypeScript type checking
pnpm run lint         # ESLint
pnpm run lint:fix     # ESLint + Prettier fix
pnpm run test         # Run test suite (Vitest)
pnpm run test:db      # Test database connection
pnpm run clean        # Clean build artifacts
```

### Docker scripts

```bash
pnpm run docker:dev                                                          # Dev mode (docker-compose.yaml)
docker-compose -f docker-compose.prod.yaml --profile production up --build  # Production stack
pnpm run dockerbuild                                                         # Build development image
pnpm run dockerbuild:prod                                                    # Build production image
```

---

## Roadmap

### Phase 3 (planned)
- Subdomain routing — `{app}.{company}.prompify.app` via Traefik + wildcard DNS
- Docker container runtime — real container start/stop for sleep/wake
- Schema-per-tenant — full PostgreSQL data isolation per company
- SSO/SAML — Okta, Azure AD, Google Workspace integration
- Approval workflow — App Owner approves before production deploy
- Bring-your-own-database — point apps at company's existing Postgres
- VPC deployment — deploy containers into customer's own AWS/GCP VPC
- App template marketplace — pre-built CRM, HR, analytics, inventory starters
