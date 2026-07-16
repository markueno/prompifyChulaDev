import pg from 'pg';
import crypto from 'crypto';
import { buildProjectChatPath, DEFAULT_PROJECT_ID } from '~/utils/chatRoutes';
import { keyForHash } from '~/lib/.server/storage';
import { computeVersionMeta } from '~/lib/snapshots/versionMeta';
import { diffManifests } from '~/lib/snapshots/diffManifests';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

// PostgreSQL connection pool
let pool: InstanceType<typeof Pool>;

/*
 * Day 20 — lazy, self-contained schema ensure for the codebase-version path.
 * saveCodebaseVersionPostgres uses getPostgresPool(), which (unlike getPostgresDatabase() in
 * database.ts) does NOT run createPostgresTables(). On prod, createPostgresTables() is also
 * fire-and-forget AND throws before reaching the change_summary ALTER (the project_id FK
 * migration at ~line 369-383 aborts on orphan chats), so the change_summary column never got
 * added → every version save 500'd with "column change_summary does not exist".
 *
 * This makes version saves self-sufficient: it idempotently creates the two tables, the
 * change_summary column, and the indexes once per process, on the SAME pool the version save
 * uses. Gated by a module flag so it runs effectively once. All statements are IF NOT EXISTS.
 */
let codebaseSchemaEnsured = false;

async function ensureCodebaseVersionSchema(): Promise<void> {
  if (codebaseSchemaEnsured) {
    return;
  }

  codebaseSchemaEnsured = true; // set first so a concurrent call doesn't re-run DDL

  try {
    const p = getPostgresPool();

    await p.query(`
      CREATE TABLE IF NOT EXISTS codebase_versions (
        id SERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        is_latest BOOLEAN NOT NULL DEFAULT false,
        manifest JSONB NOT NULL,
        description TEXT,
        file_count INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(chat_id, version_number)
      )
    `);
    await p.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_latest_per_chat ON codebase_versions(chat_id) WHERE is_latest = true'
    );
    await p.query(
      'CREATE INDEX IF NOT EXISTS idx_versions_chat_latest ON codebase_versions(chat_id, version_number DESC)'
    );
    await p.query(
      'CREATE INDEX IF NOT EXISTS idx_versions_chat_created ON codebase_versions(chat_id, created_at DESC)'
    );
    // Day 19 column — idempotent on existing DBs; this is the line createPostgresTables was missing.
    await p.query('ALTER TABLE codebase_versions ADD COLUMN IF NOT EXISTS change_summary TEXT');
    await p.query('ALTER TABLE codebase_versions ADD COLUMN IF NOT EXISTS message_id TEXT');

    await p.query(`
      CREATE TABLE IF NOT EXISTS codebase_blobs (
        sha256 TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        compressed_size_bytes INTEGER,
        r2_key TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ref_count INTEGER NOT NULL DEFAULT 1
      )
    `);
    await p.query(
      'CREATE INDEX IF NOT EXISTS idx_blobs_ref_count ON codebase_blobs(ref_count) WHERE ref_count > 0'
    );
  } catch (error) {
    // Reset so a future save retries; never block the version save on a migration failure
    // (the optimistic client cache keeps edits safe regardless).
    codebaseSchemaEnsured = false;
    console.error('ensureCodebaseVersionSchema failed (will retry next save):', error);
  }
}

/*
 * Day 20 — same hazard class as ensureCodebaseVersionSchema, for the self-hosted runtime
 * app-data layer. The data-provision routes (api.data.*, api.import-data) query/insert
 * `app_tables` via getPostgresPool(), which never runs createPostgresTables(); and
 * createPostgresTables() throws before reaching the app_tables CREATE (~line 662) on prod
 * (the project_id FK migration aborts on orphan chats). So `app_tables` may not exist on a
 * cold/partially-migrated DB → every data route 500s with "relation app_tables does not exist".
 * This idempotently ensures the registry table + indexes once per process, on the same pool.
 */
let appTablesSchemaEnsured = false;

export async function ensureAppTablesSchema(): Promise<void> {
  if (appTablesSchemaEnsured) {
    return;
  }

  appTablesSchemaEnsured = true;

  try {
    const p = getPostgresPool();

    await p.query(`
      CREATE TABLE IF NOT EXISTS app_tables (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        schema_name TEXT NOT NULL,
        table_name TEXT NOT NULL,
        logical_name TEXT NOT NULL,
        columns JSONB NOT NULL DEFAULT '[]'::jsonb,
        row_count INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(schema_name, table_name),
        UNIQUE(chat_id, logical_name)
      )
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_app_tables_user ON app_tables(user_id)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_app_tables_chat ON app_tables(chat_id)');
  } catch (error) {
    appTablesSchemaEnsured = false;
    console.error('ensureAppTablesSchema failed (will retry next call):', error);
  }
}

export function getPostgresPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL');
    }

    pool = new Pool({
      connectionString: databaseUrl,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    });

    // Test the connection
    pool.on('error', (err: Error) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

export async function createPostgresTables() {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        is_moderator BOOLEAN DEFAULT FALSE,
        verification_token TEXT,
        verification_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        reset_token TEXT,
        reset_expires TIMESTAMP
      )
    `);

    // Projects table (container for chats)
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        slug TEXT,
        name TEXT NOT NULL,
        description TEXT,
        is_archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Project members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_members (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, user_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // User sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Rate limiting table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id TEXT PRIMARY KEY,
        ip_address TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        attempts INTEGER DEFAULT 1,
        first_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ip_address, endpoint)
      )
    `);

    // Email logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email_type TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered BOOLEAN DEFAULT FALSE,
        error_message TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Chats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT,
        url_id TEXT UNIQUE,
        description TEXT,
        messages JSONB NOT NULL DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // User activity table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_activity (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_details JSONB DEFAULT '{}',
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // KooGallery instances table
    await client.query(`
      CREATE TABLE IF NOT EXISTS koogallery_instances (
        id TEXT PRIMARY KEY,
        instance_id TEXT UNIQUE NOT NULL,
        order_id TEXT NOT NULL,
        order_line_id TEXT NOT NULL,
        business_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'creating',
        test_flag BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        metadata TEXT
      )
    `);

    // KooGallery logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS koogallery_logs (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        order_id TEXT,
        instance_id TEXT,
        status TEXT NOT NULL,
        message TEXT,
        request_data TEXT,
        response_data TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT
      )
    `);

    // Chat members table (multi-user project sharing)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_members (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, user_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Chat invitations table (invite by email)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_invitations (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        email TEXT NOT NULL,
        invited_by_user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'pending',
        token TEXT UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, email),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Subscription tiers table (Trial, Builder, Innovator)
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_tiers (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        price_cents INTEGER NOT NULL DEFAULT 0,
        limits JSONB DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Subscriptions table - one per user, links to tier
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        tier_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        stripe_subscription_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tier_id) REFERENCES subscription_tiers(id)
      )
    `);

    // Seed subscription tiers (token limits per month, expire after 1 month)
    await client.query(`
      INSERT INTO subscription_tiers (id, name, display_name, price_cents, limits, sort_order)
      VALUES
        ('tier_trial', 'trial', 'Trial', 0, '{"tokens": 150000, "tokens_per_month": true}', 1),
        ('tier_builder', 'builder', 'Builder', 0, '{"tokens": 500000, "tokens_per_month": true}', 2),
        ('tier_innovator', 'innovator', 'Innovator', 0, '{"tokens": 1000000, "tokens_per_month": true}', 3)
      ON CONFLICT (id) DO UPDATE SET limits = EXCLUDED.limits
    `);

    // Prompts table - per-prompt record (account + chat)
    await client.query(`
      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, message_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Token usage - one row per prompt (tokens used for that prompt's response)
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        provider TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, message_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Token balances - allocations with effective periods (tier, top-up, promo, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_balances (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_reference_id TEXT,
        tokens_allocated INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        effective_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        effective_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT chk_token_balances_source CHECK (source IN ('tier', 'top_up', 'promo', 'grant'))
      )
    `);

    // Level B: which token_usage row drew how many tokens from which token_balances row
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_consumption_allocations (
        id TEXT PRIMARY KEY,
        token_usage_id TEXT NOT NULL,
        token_balance_id TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_consumption_alloc_tokens_pos CHECK (tokens > 0),
        FOREIGN KEY (token_usage_id) REFERENCES token_usage(id) ON DELETE CASCADE,
        FOREIGN KEY (token_balance_id) REFERENCES token_balances(id) ON DELETE CASCADE
      )
    `);

    // Backward-compatible migration: enforce project-scoped chats
    await client.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS project_id TEXT`);
    await client.query(
      `
      INSERT INTO projects (id, owner_user_id, slug, name, description)
      SELECT
        'proj_personal_' || u.id,
        u.id,
        $1,
        'Personal',
        'Default personal project'
      FROM users u
      ON CONFLICT (id) DO NOTHING
    `,
      [DEFAULT_PROJECT_ID]
    );
    await client.query(`
      INSERT INTO project_members (id, project_id, user_id, role)
      SELECT
        md5('owner:' || p.id || ':' || p.owner_user_id),
        p.id,
        p.owner_user_id,
        'owner'
      FROM projects p
      ON CONFLICT (project_id, user_id) DO NOTHING
    `);
    await client.query(`
      UPDATE chats c
      SET project_id = 'proj_personal_' || c.user_id
      WHERE c.project_id IS NULL
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_chats_project_id'
        ) THEN
          ALTER TABLE chats
          ADD CONSTRAINT fk_chats_project_id
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await client.query('ALTER TABLE chats ALTER COLUMN project_id SET NOT NULL');

    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions(token_hash)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON rate_limits(ip_address, endpoint)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id ON projects(owner_user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_projects_owner_slug ON projects(owner_user_id, slug)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chats_project_id ON chats(project_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chats_url_id ON chats(url_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_activity_action_type ON user_activity(action_type)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_order_id ON koogallery_instances(order_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_instance_id ON koogallery_instances(instance_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_endpoint ON koogallery_logs(endpoint)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_order_id ON koogallery_logs(order_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_instance_id ON koogallery_logs(instance_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_timestamp ON koogallery_logs(timestamp)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id ON chat_members(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_invitations_chat_id ON chat_invitations(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_invitations_email ON chat_invitations(email)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_invitations_token ON chat_invitations(token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_subscriptions_tier_id ON subscriptions(tier_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prompts_chat_id ON prompts(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_chat_id ON token_usage(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_message_id ON token_usage(message_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_user_created ON token_usage(user_id, created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_balances_user_id ON token_balances(user_id)');
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_token_balances_user_effective ON token_balances(user_id, effective_start, effective_end)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_token_consumption_alloc_usage ON token_consumption_allocations(token_usage_id)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_token_consumption_alloc_balance ON token_consumption_allocations(token_balance_id)'
    );

    // Public contact form (landing page) — no FK to users
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_submissions (
        id TEXT PRIMARY KEY,
        enquiry_type TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        country TEXT NOT NULL,
        country_code TEXT,
        message TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON contact_submissions(created_at)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_contact_submissions_enquiry_type ON contact_submissions(enquiry_type)'
    );

    // Phase 2: Companies (tenants)
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        plan TEXT NOT NULL DEFAULT 'starter',
        github_org TEXT,
        schema_name TEXT UNIQUE,
        owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Phase 2: Company membership + RBAC
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_members (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'developer',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, user_id)
      )
    `);

    // Phase 2: Extend projects with company context + lifecycle columns
    await client.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE CASCADE`
    );
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS runtime_type TEXT NOT NULL DEFAULT 'static'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo TEXT`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS deploy_url TEXT`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_logs TEXT`);

    // Phase 2: Audit log (append-only)
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        payload JSONB,
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_company_members_company ON company_members(company_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id, status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON audit_logs(project_id)');

    /*
     * ── Codebase snapshots (ARCHITECTURE-v2 Phase 1, doc lines 118-161) ──────────
     * Content-addressed version history. Manifests (path -> sha256) live here; the
     * file BYTES live in object storage (OBS), keyed by SHA-256. No code reads/writes
     * these yet — wired starting Day 6.
     */
    await client.query(`
      CREATE TABLE IF NOT EXISTS codebase_versions (
        id SERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        is_latest BOOLEAN NOT NULL DEFAULT false,
        manifest JSONB NOT NULL,
        description TEXT,
        file_count INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(chat_id, version_number)
      )
    `);
    /*
     * Only one "latest" version per chat (partial unique index — relies on the
     * FOR UPDATE lock in saveCodebaseVersion, Day 6, to avoid concurrent-save races).
     */
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_latest_per_chat ON codebase_versions(chat_id) WHERE is_latest = true'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_versions_chat_latest ON codebase_versions(chat_id, version_number DESC)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_versions_chat_created ON codebase_versions(chat_id, created_at DESC)'
    );

    /*
     * Day 19 — nullable change_summary holds the compact added/modified/removed summary
     * (e.g. "Edited App.tsx (+1, -1)") shown on the version-history metadata line.
     * Idempotent: safe to re-run on existing prod DBs.
     */
    await client.query('ALTER TABLE codebase_versions ADD COLUMN IF NOT EXISTS change_summary TEXT');

    /*
     * Blob registry: every unique file by SHA-256, with ref_count for GC (Day 18).
     * r2_key = the object-storage key path (in OBS); column name kept per doc line 154.
     */
    await client.query(`
      CREATE TABLE IF NOT EXISTS codebase_blobs (
        sha256 TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        compressed_size_bytes INTEGER,
        r2_key TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ref_count INTEGER NOT NULL DEFAULT 1
      )
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_blobs_ref_count ON codebase_blobs(ref_count) WHERE ref_count > 0'
    );

    /*
     * ── Runtime app-data registry (ARCHITECTURE-v2 Part 2, self-hosted) ──────────
     * Each USER gets one PG schema `usr_<userId>` holding their imported/generated
     * app tables. This registry maps (chat_id, logical_name) -> (schema, table) so
     * getSchemaContext(chatId) can list only the current app's tables, and the data
     * proxy can resolve a (chatId, resource) request to the physical table.
     *
     * Physical table_name == logical_name; uniqueness is enforced both within a
     * user's schema (UNIQUE schema_name+table_name) and within a chat
     * (UNIQUE chat_id+logical_name). A user who already has "orders" in another
     * chat gets a 409 on import (pick another name).
     */
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_tables (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        schema_name TEXT NOT NULL,
        table_name TEXT NOT NULL,
        logical_name TEXT NOT NULL,
        columns JSONB NOT NULL DEFAULT '[]'::jsonb,
        row_count INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(schema_name, table_name),
        UNIQUE(chat_id, logical_name)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_app_tables_user ON app_tables(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_app_tables_chat ON app_tables(chat_id)');

    console.log('PostgreSQL tables created successfully');
  } catch (error) {
    console.error('Error creating PostgreSQL tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Database helper functions for PostgreSQL
export type ContactSubmissionInput = {
  id: string;
  enquiryType: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  countryCode: string | null;
  message: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function insertContactSubmissionPostgres(row: ContactSubmissionInput): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `INSERT INTO contact_submissions (
        id, enquiry_type, name, email, phone, country, country_code, message, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        row.enquiryType,
        row.name,
        row.email,
        row.phone,
        row.country,
        row.countryCode,
        row.message,
        row.ipAddress ?? null,
        row.userAgent ?? null,
      ]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error inserting contact submission:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getUserByEmailPostgres(email: string) {
  const pool = getPostgresPool();
  let client;

  try {
    client = await pool.connect();

    const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);

    return result.rows[0] || null;
  } catch (error: any) {
    console.error('❌ Error getting user by email:', error);

    // Re-throw connection errors so they can be handled upstream
    if (
      error.message?.includes('timeout') ||
      error.message?.includes('Connection terminated') ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ENOTFOUND')
    ) {
      throw error; // Let the caller handle connection errors
    }

    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/** Create Trial subscription for user with 1-month effective period and token balance. Skips if already exists. */
async function createSubscriptionForUserWithClient(client: PoolClient, userId: string): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const subId = crypto.randomUUID();
  const insertResult = await client.query(
    `INSERT INTO subscriptions (id, user_id, tier_id, status, current_period_start, current_period_end)
     VALUES ($1, $2, 'tier_trial', 'active', $3, $4)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING id`,
    [subId, userId, now.toISOString(), periodEnd.toISOString()]
  );

  if (insertResult.rows.length === 0) {
    return;
  }

  const tierResult = await client.query(`SELECT limits FROM subscription_tiers WHERE id = 'tier_trial'`);
  const limits = tierResult.rows[0]?.limits;
  const tokens = limits?.tokens ?? 150000;

  const balanceId = crypto.randomUUID();
  await client.query(
    `INSERT INTO token_balances (id, user_id, source, source_reference_id, tokens_allocated, tokens_used, effective_start, effective_end)
     VALUES ($1, $2, 'tier', $3, $4, 0, $5, $6)`,
    [balanceId, userId, subId, tokens, now.toISOString(), periodEnd.toISOString()]
  );
}

/** Get subscription by user ID. For future subscription/upgrade logic. */
export async function getSubscriptionByUserIdPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT s.*, st.name as tier_name, st.display_name as tier_display_name, st.price_cents, st.limits
      FROM subscriptions s
      JOIN subscription_tiers st ON s.tier_id = st.id
      WHERE s.user_id = $1
    `,
      [userId]
    );
    return result.rows[0] || null;
  } catch (error: any) {
    console.error('Error getting subscription by user:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function createUserPostgres(user: any) {
  const pool = getPostgresPool();
  let client;

  try {
    client = await pool.connect();

    const result = await client.query(
      `
      INSERT INTO users (id, email, password_hash, is_verified, verification_token, verification_expires, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
      [
        user.id,
        user.email,
        user.passwordHash,
        user.isVerified,
        user.verificationToken,
        user.verificationExpires,
        user.createdAt,
      ]
    );

    return result.rowCount !== null && result.rowCount > 0;
  } catch (error: any) {
    console.error('❌ Error creating user:', error);

    // Re-throw connection errors so they can be handled upstream
    if (
      error.message?.includes('timeout') ||
      error.message?.includes('Connection terminated') ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ENOTFOUND')
    ) {
      throw error;
    }

    // Re-throw duplicate key errors
    if (
      error.code === '23505' ||
      error.message?.includes('duplicate key') ||
      error.message?.includes('unique constraint')
    ) {
      throw error;
    }

    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function getUserByVerificationTokenPostgres(token: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query('SELECT * FROM users WHERE verification_token = $1', [token]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by verification token:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function verifyUserPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
      UPDATE users 
      SET is_verified = TRUE, verification_token = NULL, verification_expires = NULL 
      WHERE id = $1
    `,
      [userId]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    try {
      await createSubscriptionForUserWithClient(client, userId);
    } catch (subErr: any) {
      console.warn('Could not create subscription (table may not exist):', subErr?.message ?? subErr);
    }
    await client.query('COMMIT');

    return true;
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('Error verifying user:', error);

    return false;
  } finally {
    client.release();
  }
}

const RESET_TOKEN_EXPIRY_HOURS = 1;

/** Create a password reset token for the user with the given email. Returns the token and user, or null. */
export async function createPasswordResetTokenPostgres(
  email: string
): Promise<{ token: string; user: { id: string; email: string } } | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const userResult = await client.query('SELECT id, email FROM users WHERE email = $1', [email]);
    const user = userResult.rows[0];

    if (!user) {
      return null;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await client.query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3', [
      token,
      expires,
      user.id,
    ]);

    return { token, user: { id: user.id, email: user.email } };
  } catch (error) {
    console.error('Error creating password reset token:', error);
    return null;
  } finally {
    client.release();
  }
}

/** Get user by reset token (for validating link). */
export async function getUserByResetTokenPostgres(token: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query('SELECT * FROM users WHERE reset_token = $1', [token]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by reset token:', error);
    return null;
  } finally {
    client.release();
  }
}

/** Set new password from valid reset token and clear token. Returns true if updated. */
export async function setPasswordFromResetTokenPostgres(token: string, passwordHash: string): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      UPDATE users
      SET password_hash = $1, reset_token = NULL, reset_expires = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE reset_token = $2 AND reset_expires > CURRENT_TIMESTAMP
    `,
      [passwordHash, token]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error setting password from reset token:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateLoginAttemptsPostgres(email: string, attempts: number) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE users 
      SET login_attempts = $1, last_login = CURRENT_TIMESTAMP 
      WHERE email = $2
    `,
      [attempts, email]
    );
    return true;
  } catch (error) {
    console.error('Error updating login attempts:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function resetLoginAttemptsPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE users 
      SET login_attempts = 0, last_login = CURRENT_TIMESTAMP 
      WHERE id = $1
    `,
      [userId]
    );
    return true;
  } catch (error) {
    console.error('Error resetting login attempts:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function checkRateLimitPostgres(
  key: string,
  endpoint: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowSeconds * 1000);

    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT attempts, first_attempt FROM rate_limits WHERE ip_address = $1 AND endpoint = $2 FOR UPDATE`,
      [key, endpoint]
    );

    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO rate_limits (id, ip_address, endpoint, attempts, first_attempt, last_attempt)
         VALUES (gen_random_uuid()::text, $1, $2, 1, $3, $3)`,
        [key, endpoint, now]
      );
      await client.query('COMMIT');
      return { allowed: true };
    }

    const row = existing.rows[0];
    const firstAttempt = new Date(row.first_attempt);
    const elapsed = (now.getTime() - firstAttempt.getTime()) / 1000;

    if (elapsed > windowSeconds) {
      await client.query(
        `UPDATE rate_limits SET attempts = 1, first_attempt = $1, last_attempt = $1 WHERE ip_address = $2 AND endpoint = $3`,
        [now, key, endpoint]
      );
      await client.query('COMMIT');
      return { allowed: true };
    }

    if (row.attempts >= maxAttempts) {
      await client.query('COMMIT');
      const retryAfterSeconds = Math.ceil(windowSeconds - elapsed);
      return { allowed: false, retryAfterSeconds };
    }

    await client.query(
      `UPDATE rate_limits SET attempts = attempts + 1, last_attempt = $1 WHERE ip_address = $2 AND endpoint = $3`,
      [now, key, endpoint]
    );
    await client.query('COMMIT');
    return { allowed: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function logEmailPostgres(userId: string, emailType: string, delivered: boolean, errorMessage?: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      INSERT INTO email_logs (id, user_id, email_type, delivered, error_message)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [crypto.randomUUID(), userId, emailType, delivered, errorMessage]
    );
    return true;
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function createUserSessionPostgres(
  userId: string,
  tokenHash: string,
  expiresAt: string,
  ipAddress?: string,
  userAgent?: string
) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    // First, invalidate any existing sessions for this user (single session enforcement)
    await invalidateUserSessionsPostgres(userId);

    // Create new session
    const result = await client.query(
      `
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [crypto.randomUUID(), userId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
    );

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error creating user session:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function invalidateUserSessionsPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    return true;
  } catch (error) {
    console.error('Error invalidating user sessions:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function validateSessionPostgres(tokenHash: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT us.*, u.email, u.is_verified 
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.token_hash = $1 AND us.expires_at > NOW()
    `,
      [tokenHash]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('Error validating session:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function updateSessionActivityPostgres(tokenHash: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE user_sessions 
      SET last_used = NOW()
      WHERE token_hash = $1
    `,
      [tokenHash]
    );
    return true;
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function logoutUserPostgres(tokenHash: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    return true;
  } catch (error) {
    console.error('Error logging out user:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getActiveSessionCountPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT COUNT(*) as count 
      FROM user_sessions 
      WHERE user_id = $1 AND expires_at > NOW()
    `,
      [userId]
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error getting active session count:', error);
    return 0;
  } finally {
    client.release();
  }
}

// Token usage and balance functions

/** Apply FIFO consumption (+ optional overage on sink row). If tokenUsageId is set, writes Level B allocation rows. */
async function applyTokenConsumptionInTransaction(
  client: PoolClient,
  userId: string,
  n: number,
  tokenUsageId: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const balances = await client.query(
    `SELECT id, tokens_allocated, tokens_used
     FROM token_balances
     WHERE user_id = $1
       AND effective_start <= $2::timestamptz
       AND (effective_end IS NULL OR effective_end >= $2::timestamptz)
     ORDER BY effective_end ASC NULLS LAST`,
    [userId, now]
  );

  const insertAllocation = async (tokenBalanceId: string, tokens: number) => {
    if (!tokenUsageId || tokens <= 0) {
      return;
    }

    await client.query(
      `INSERT INTO token_consumption_allocations (id, token_usage_id, token_balance_id, tokens)
       VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), tokenUsageId, tokenBalanceId, tokens]
    );
  };

  let remaining = n;

  for (const row of balances.rows) {
    if (remaining <= 0) {
      break;
    }

    const allocated = Number(row.tokens_allocated);
    const used = Number(row.tokens_used);
    const available = allocated - used;

    if (available <= 0) {
      continue;
    }

    const deduct = Math.min(remaining, available);
    await client.query(
      `UPDATE token_balances SET tokens_used = tokens_used + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [row.id, deduct]
    );
    await insertAllocation(row.id as string, deduct);
    remaining -= deduct;
  }

  if (remaining > 0) {
    const rows = balances.rows as { id: string }[];

    if (rows.length > 0) {
      const sinkId = rows[rows.length - 1].id as string;
      await client.query(
        `UPDATE token_balances SET tokens_used = tokens_used + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [sinkId, remaining]
      );
      await insertAllocation(sinkId, remaining);
    } else {
      const newBalanceId = crypto.randomUUID();
      await client.query(
        `INSERT INTO token_balances (id, user_id, source, source_reference_id, tokens_allocated, tokens_used, effective_start, effective_end)
         VALUES ($1, $2, 'grant', 'balance-overage', 0, $3, $4::timestamptz, NULL)`,
        [newBalanceId, userId, remaining, now]
      );
      await insertAllocation(newBalanceId, remaining);
    }
  }
}

/** Level B: insert token_usage + allocation rows + update token_balances in one transaction. */
export async function insertTokenUsageAndConsumePostgres(params: {
  chatId: string;
  messageId: string;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}): Promise<boolean> {
  const n = Math.floor(Number(params.totalTokens));

  if (!Number.isFinite(n) || n <= 0) {
    return false;
  }

  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tokenUsageId = crypto.randomUUID();
    await client.query(
      `INSERT INTO token_usage (id, chat_id, message_id, user_id, prompt_tokens, completion_tokens, total_tokens, model, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tokenUsageId,
        params.chatId,
        params.messageId,
        params.userId,
        params.promptTokens,
        params.completionTokens,
        params.totalTokens,
        params.model ?? null,
        params.provider ?? null,
      ]
    );
    await applyTokenConsumptionInTransaction(client, params.userId, n, tokenUsageId);
    await client.query('COMMIT');

    return true;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    console.error('Error in insertTokenUsageAndConsumePostgres:', error);

    return false;
  } finally {
    client.release();
  }
}

export async function insertTokenUsagePostgres(params: {
  chatId: string;
  messageId: string;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO token_usage (id, chat_id, message_id, user_id, prompt_tokens, completion_tokens, total_tokens, model, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        params.chatId,
        params.messageId,
        params.userId,
        params.promptTokens,
        params.completionTokens,
        params.totalTokens,
        params.model ?? null,
        params.provider ?? null,
      ]
    );

    return true;
  } catch (error) {
    console.error('Error inserting token usage:', error);
    return false;
  } finally {
    client.release();
  }
}

/** Level A fallback: updates balances only (no allocation rows). Prefer insertTokenUsageAndConsumePostgres for chat. */
export async function consumeTokenBalancePostgres(userId: string, tokensToConsume: number): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const n = Math.floor(Number(tokensToConsume));

    if (!Number.isFinite(n) || n <= 0) {
      return true;
    }

    await client.query('BEGIN');
    await applyTokenConsumptionInTransaction(client, userId, n, null);
    await client.query('COMMIT');

    return true;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Error consuming token balance:', error);

    return false;
  } finally {
    client.release();
  }
}

export async function getTokenBalanceRemainingPostgres(userId: string): Promise<number> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const now = new Date().toISOString();
    const result = await client.query(
      `SELECT COALESCE(SUM(tokens_allocated - tokens_used), 0)::bigint as remaining
       FROM token_balances
       WHERE user_id = $1
         AND effective_start <= $2
         AND (effective_end IS NULL OR effective_end >= $2)`,
      [userId, now]
    );

    return parseInt(String(result.rows[0]?.remaining ?? 0), 10);
  } catch (error) {
    console.error('Error getting token balance:', error);
    return 0;
  } finally {
    client.release();
  }
}

async function ensureDefaultProjectForUser(client: PoolClient, userId: string): Promise<string> {
  const defaultProjectId = `proj_personal_${userId}`;
  await client.query(
    `
      INSERT INTO projects (id, owner_user_id, slug, name, description)
      VALUES ($1, $2, $3, 'Personal', 'Default personal project')
      ON CONFLICT (id) DO NOTHING
    `,
    [defaultProjectId, userId, DEFAULT_PROJECT_ID]
  );
  await client.query(
    `
      INSERT INTO project_members (id, project_id, user_id, role)
      VALUES ($1, $2, $3, 'owner')
      ON CONFLICT (project_id, user_id) DO NOTHING
    `,
    [crypto.randomUUID(), defaultProjectId, userId]
  );

  return defaultProjectId;
}

async function resolveWritableProjectId(client: PoolClient, userId: string, projectId?: string): Promise<string> {
  if (!projectId) {
    return ensureDefaultProjectForUser(client, userId);
  }

  const access = await client.query(
    `
      SELECT 1
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $2
      WHERE p.id = $1 AND (p.owner_user_id = $2 OR pm.user_id = $2)
      LIMIT 1
    `,
    [projectId, userId]
  );

  if (access.rows.length > 0) {
    return projectId;
  }

  return ensureDefaultProjectForUser(client, userId);
}

// Chat Management Functions
export async function saveChatPostgres(userId: string, chatData: any): Promise<string | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const {
      id,
      urlId,
      url_id: legacyUrlId,
      description,
      messages,
      metadata,
      projectId,
      project_id: legacyProjectId,
    } = chatData;
    const resolvedUrlId = urlId ?? legacyUrlId;
    const resolvedProjectId = await resolveWritableProjectId(client, userId, projectId ?? legacyProjectId);
    const query = `
      INSERT INTO chats (id, user_id, project_id, url_id, description, messages, metadata, updated_at, last_activity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        description = EXCLUDED.description,
        messages = EXCLUDED.messages,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP,
        last_activity = CURRENT_TIMESTAMP
      RETURNING id
    `;
    /*
     * PostgreSQL json/jsonb cannot store the NUL character U+0000 (error 22P05,
     * "unsupported Unicode escape sequence"). Messages can embed binary file content
     * (e.g. a generated public/favicon.ico) as boltActions, which contains NUL bytes;
     * JSON.stringify encodes each as the 6-char escape backslash-u-0000, which the JSONB
     * column then rejects. Strip those escapes before insert. Binary file bytes are
     * preserved losslessly by the snapshot blob path; the chat message is only a replay
     * fallback. See the regex literal below for the exact escape being removed.
     */
    // Null-safe: JSON.stringify(undefined) returns undefined (e.g. no metadata) — pass it
    // through untouched so pg receives the same value the original code did.
    const stripNullEscapes = (json: string | undefined) =>
      typeof json === 'string' ? json.replace(/\\u0000/g, '') : json;
    const result = await client.query(query, [
      id,
      userId,
      resolvedProjectId,
      resolvedUrlId,
      description,
      stripNullEscapes(JSON.stringify(messages)),
      stripNullEscapes(JSON.stringify(metadata)),
    ]);
    const savedId = result.rows[0]?.id || null;

    // Project creator is always the owner: add them to chat_members with role 'owner'
    if (savedId) {
      await client.query(
        `
        INSERT INTO chat_members (id, chat_id, user_id, role)
        VALUES ($1, $2, $3, 'owner')
        ON CONFLICT (chat_id, user_id) DO NOTHING
      `,
        [crypto.randomUUID(), id, userId]
      );
    }

    // Sync prompts table from user messages (record account + chat per prompt)
    if (savedId && Array.isArray(messages)) {
      await syncPromptsFromChatMessagesPostgres(client, id, messages, userId);
    }

    return savedId;
  } catch (error) {
    console.error('Error saving chat to PostgreSQL:', error);
    return null;
  } finally {
    client.release();
  }
}

/** Sync prompts table from chat messages - one row per user prompt with account + chat */
async function syncPromptsFromChatMessagesPostgres(
  client: PoolClient,
  chatId: string,
  messages: any[],
  defaultUserId: string
): Promise<void> {
  for (const msg of messages) {
    if (msg?.role !== 'user') {
      continue;
    }

    const messageId = msg.id;

    if (!messageId || typeof messageId !== 'string') {
      continue;
    }

    const userId = defaultUserId;
    await client.query(
      `INSERT INTO prompts (id, chat_id, user_id, message_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id, message_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [crypto.randomUUID(), chatId, userId, messageId]
    );
  }
}

export async function insertPromptPostgres(params: {
  chatId: string;
  userId: string;
  messageId: string;
}): Promise<string | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO prompts (id, chat_id, user_id, message_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id, message_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [id, params.chatId, params.userId, params.messageId]
    );

    return id;
  } catch (error) {
    console.error('Error inserting prompt:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getPromptsByChatIdPostgres(
  chatId: string,
  requestingUserId: string,
  isModerator?: boolean
): Promise<{ id: string; message_id: string; user_id: string; email: string; created_at: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    // Ensure requester has access to the chat
    const accessCheck = await client.query(
      `SELECT 1 FROM chats c
       LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $2
       WHERE (c.id = $1 OR c.url_id = $1)
         AND (c.user_id = $2 OR cm.user_id = $2 OR p.owner_user_id = $2 OR pm.user_id = $2)`,
      [chatId, requestingUserId]
    );

    if (accessCheck.rows.length === 0 && !isModerator) {
      return [];
    }

    const result = await client.query(
      `SELECT p.id, p.message_id, p.user_id, p.created_at, u.email
       FROM prompts p
       JOIN users u ON p.user_id = u.id
       WHERE p.chat_id = (SELECT id FROM chats WHERE id = $1 OR url_id = $1 LIMIT 1)
       ORDER BY p.created_at ASC`,
      [chatId]
    );

    return result.rows.map((r: any) => ({
      id: r.id,
      message_id: r.message_id,
      user_id: r.user_id,
      email: r.email,
      created_at: r.created_at,
    }));
  } catch (error) {
    console.error('Error fetching prompts:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getChatsByUserPostgres(userId: string, isModerator?: boolean): Promise<any[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    if (isModerator) {
      const result = await client.query(`
        SELECT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived
        FROM chats c
        ORDER BY c.updated_at DESC
      `);
      return result.rows.map(row => ({
        ...row,
        messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      }));
    }

    // Include chats where user can access the owning project
    const query = `
      SELECT DISTINCT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $1
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $1
      WHERE c.user_id = $1 OR cm.user_id = $1 OR p.owner_user_id = $1 OR pm.user_id = $1
      ORDER BY c.updated_at DESC
    `;
    const result = await client.query(query, [userId]);

    return result.rows.map(row => ({
      ...row,
      messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    }));
  } catch (error) {
    console.error('Error fetching chats from PostgreSQL:', error);
    return [];
  } finally {
    client.release();
  }
}

/**
 * Save a new codebase version for a chat in ONE transaction.
 * Locks the chat row (FOR UPDATE) so concurrent saves from different tabs can't both
 * insert is_latest=true (which the partial unique index would otherwise reject).
 * Returns the new version_number. Source: ARCHITECTURE-v2.md:361-392 (Day 6).
 */
export async function saveCodebaseVersionPostgres(params: {
  chatId: string;
  userId: string;
  manifest: Record<string, string>; // path -> sha256
  blobSizes: Record<string, number>; // sha256 -> size_bytes
  description?: string;
  /** Day 17 — chat message this version was saved after (null for manual IDE-edit saves). */
  messageId?: string;
  /**
   * Day 19 — optional client-supplied label (the triggering user prompt, truncated) that
   * overrides the chat-title description for AI turns. When absent the caller-supplied
   * description (or a server-computed diff summary) is used.
   */
  label?: string;
  /** Day 19 — compact added/modified/removed summary to show on the history metadata line. */
  changeSummary?: string;
}): Promise<number> {
  const { chatId, userId, manifest, blobSizes, messageId, label, changeSummary: clientChangeSummary } = params;
  const { fileCount, totalBytes, hashes } = computeVersionMeta(manifest, blobSizes);

  // Day 20 — ensure the codebase-version schema exists on THIS pool before touching it. The
  // version-save path uses getPostgresPool(), which doesn't run createPostgresTables(); this
  // idempotently guarantees the tables + the change_summary column exist (the missing column
  // was causing every save to 500 with "column change_summary does not exist").
  await ensureCodebaseVersionSchema();

  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Serialize concurrent saves for this chat (the lock the whole design hinges on).
    await client.query('SELECT 1 FROM chats WHERE id = $1 FOR UPDATE', [chatId]);

    /*
     * Day 19 — Fix A: no-op guard. Load the current is_latest manifest and deep-compare it to
     * the incoming manifest. If IDENTICAL, this turn changed no files (e.g. a question-only
     * assistant response). Skip the insert + ref_count bump entirely, but update the latest
     * version's message_id so rewind-to-latest stays exact (OPEN DECISION #2 = skip-but-update).
     * Race-safe: the FOR UPDATE lock above already serializes concurrent saves.
     *
     * Day 20 — the SELECT reads only version_number + manifest (NOT change_summary): the guard
     * recomputes the summary from the manifest via diffSummaryFor, so it must not depend on the
     * change_summary column existing.
     */
    const latestRes = await client.query(
      'SELECT version_number, manifest FROM codebase_versions WHERE chat_id = $1 AND is_latest = true LIMIT 1',
      [chatId]
    );

    if (latestRes.rows.length > 0) {
      const latestRow = latestRes.rows[0];
      const latestManifest =
        typeof latestRow.manifest === 'string' ? JSON.parse(latestRow.manifest) : latestRow.manifest;
      const diff = diffManifests(latestManifest, manifest);

      if (!diff.changed) {
        // No file change — update message_id (if provided) so rewind mapping stays current.
        if (messageId) {
          await client.query(
            'UPDATE codebase_versions SET message_id = $1 WHERE chat_id = $2 AND is_latest = true',
            [messageId, chatId]
          );
        }

        await client.query('COMMIT');

        return Number(latestRow.version_number);
      }
    }

    /*
     * Resolve the stored per-version description (Fix B): prefer the client label, else the
     * caller-supplied description, else a server-computed diff summary as a last resort. This
     * decouples version names from the chat title.
     */
    const serverChangeSummary = clientChangeSummary ?? diffSummaryFor(latestRes.rows[0]?.manifest, manifest);
    const storedDescription = label ?? params.description ?? serverChangeSummary;

    // 2. Next version number for this chat.
    const versionRes = await client.query(
      'SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM codebase_versions WHERE chat_id = $1',
      [chatId]
    );
    const versionNumber = Number(versionRes.rows[0].next);

    // 3. Demote the current latest, then 4. insert the new version as latest.
    await client.query('UPDATE codebase_versions SET is_latest = false WHERE chat_id = $1 AND is_latest = true', [
      chatId,
    ]);
    await client.query(
      `INSERT INTO codebase_versions
         (chat_id, user_id, version_number, is_latest, manifest, description, file_count, total_bytes, message_id, change_summary)
       VALUES ($1, $2, $3, true, $4::jsonb, $5, $6, $7, $8, $9)`,
      [
        chatId,
        userId,
        versionNumber,
        JSON.stringify(manifest),
        storedDescription ?? null,
        fileCount,
        totalBytes,
        messageId ?? null,
        serverChangeSummary ?? null,
      ]
    );

    if (hashes.length > 0) {
      // 5. Bump ref_count for blobs that already exist.
      await client.query('UPDATE codebase_blobs SET ref_count = ref_count + 1 WHERE sha256 = ANY($1)', [hashes]);

      // 6. Insert any new blobs (ref_count defaults to 1); existing rows are no-ops.
      const valuesSql: string[] = [];
      const args: unknown[] = [];
      let i = 1;

      for (const sha of hashes) {
        valuesSql.push(`($${i++}, $${i++}, $${i++})`);
        args.push(sha, blobSizes[sha] ?? 0, keyForHash(sha));
      }

      await client.query(
        `INSERT INTO codebase_blobs (sha256, size_bytes, r2_key)
         VALUES ${valuesSql.join(', ')}
         ON CONFLICT (sha256) DO NOTHING`,
        args
      );
    }

    await client.query('COMMIT');

    return versionNumber;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Day 19 — compute a compact change-summary from the previous latest manifest (raw jsonb row
 * value, may be string or already-parsed object) and the incoming manifest. When there is no
 * prior version (the very first save of a chat), diff against an empty manifest so the first
 * version is named "Added <files> (+N)" rather than getting no summary.
 */
function diffSummaryFor(
  previousManifestRaw: unknown,
  newManifest: Record<string, string>,
): string {
  if (previousManifestRaw === undefined || previousManifestRaw === null) {
    return diffManifests({}, newManifest).summary;
  }

  const previous =
    typeof previousManifestRaw === 'string' ? JSON.parse(previousManifestRaw) : previousManifestRaw;

  return diffManifests(previous, newManifest).summary;
}

/**
 * Fetch the latest codebase version's manifest for a chat (read-only).
 * Returns null when the chat has no saved version yet. Source: ARCHITECTURE-v2.md:411-413 (Day 7).
 */
export async function getLatestCodebaseVersionPostgres(
  chatId: string
): Promise<{ versionNumber: number; manifest: Record<string, string> } | null> {
  const pool = getPostgresPool();
  const result = await pool.query(
    'SELECT version_number, manifest FROM codebase_versions WHERE chat_id = $1 AND is_latest = true LIMIT 1',
    [chatId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;

  return { versionNumber: Number(row.version_number), manifest };
}

/**
 * Day 18 — garbage collection (ARCHITECTURE-v2.md:504-526), one transaction:
 *   1. delete non-latest versions beyond the retention window (keep `retainPerChat` per chat),
 *   2. decrement ref_count once per deleted version per referenced blob,
 *   3. delete blob rows whose ref_count dropped to <= 0.
 * Returns the deleted versions count and the ORPHANED blob hashes — the caller deletes those
 * keys from object storage AFTER commit (a stray object in OBS is harmless; a dangling DB row
 * pointing at a deleted object is not, hence DB-first ordering).
 * `dryRun` executes everything and ROLLS BACK, returning what WOULD happen — the plan's
 * mandatory first-run mode (Step 18.5: never enable real deletion until a dry run is sane).
 */
export async function gcCodebaseVersionsPostgres(options: {
  retainPerChat?: number;
  dryRun: boolean;
}): Promise<{ versionsDeleted: number; blobsDeleted: number; orphanHashes: string[] }> {
  const retain = options.retainPerChat ?? 30;
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Delete versions beyond retention (never the latest), returning manifests so we know
    //    which blob refs to release.
    const deleted = await client.query(
      `DELETE FROM codebase_versions
       WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY version_number DESC) AS rn
           FROM codebase_versions
           WHERE is_latest = false
         ) ranked
         WHERE rn > $1
       )
       RETURNING manifest`,
      [retain]
    );

    // 2. Decrement ref_count once per deleted version per referenced blob (mirrors the +1 per
    //    version applied on save/rollback).
    const decrements = new Map<string, number>();

    for (const row of deleted.rows) {
      const manifest: Record<string, string> =
        typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;

      for (const sha of new Set(Object.values(manifest))) {
        decrements.set(sha, (decrements.get(sha) ?? 0) + 1);
      }
    }

    for (const [sha, count] of decrements) {
      await client.query('UPDATE codebase_blobs SET ref_count = ref_count - $2 WHERE sha256 = $1', [sha, count]);
    }

    // 3. Remove unreferenced blob rows; their hashes go back to the caller for OBS deletion.
    const orphans = await client.query('DELETE FROM codebase_blobs WHERE ref_count <= 0 RETURNING sha256');

    if (options.dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    return {
      versionsDeleted: deleted.rowCount ?? 0,
      blobsDeleted: orphans.rowCount ?? 0,
      orphanHashes: orphans.rows.map(r => r.sha256 as string),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Day 16 — transactional rollback: restore version N by APPENDING a copy of its manifest as
 * the new latest version (never mutating history — you can roll back from a rollback, and
 * nothing is ever deleted; ARCHITECTURE-v2.md:497). Blobs are shared, so only ref_counts are
 * bumped. Same FOR UPDATE lock as saveCodebaseVersionPostgres so a concurrent save and
 * rollback serialize instead of corrupting is_latest.
 * Source: ARCHITECTURE-v2.md:461-494 (spec SQL reuses $2 for userId AND version; split here).
 * Returns the new version number, or null when the target version does not exist.
 */
export async function rollbackCodebaseVersionPostgres(
  chatId: string,
  userId: string,
  targetVersion: number
): Promise<number | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock for race safety (serializes with saves and other rollbacks on this chat).
    await client.query('SELECT 1 FROM chats WHERE id = $1 FOR UPDATE', [chatId]);

    // Target must exist (also snapshots its manifest for the ref_count bump below).
    const target = await client.query(
      'SELECT manifest, file_count, total_bytes FROM codebase_versions WHERE chat_id = $1 AND version_number = $2',
      [chatId, targetVersion]
    );

    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // Unmark current latest.
    await client.query('UPDATE codebase_versions SET is_latest = false WHERE chat_id = $1 AND is_latest = true', [
      chatId,
    ]);

    // Append a copy of the old manifest as the new max version (blobs shared, not copied).
    const inserted = await client.query(
      `INSERT INTO codebase_versions
         (chat_id, user_id, version_number, is_latest, manifest, description, file_count, total_bytes)
       SELECT chat_id, $3,
         (SELECT COALESCE(MAX(version_number), 0) + 1 FROM codebase_versions WHERE chat_id = $1),
         true, manifest,
         'Rollback to v' || version_number,
         file_count, total_bytes
       FROM codebase_versions
       WHERE chat_id = $1 AND version_number = $2
       RETURNING version_number`,
      [chatId, targetVersion, userId]
    );

    // Bump ref_count on every blob the restored version references (once per blob — the
    // IN(subquery) form updates each matching row a single time, matching the save path's
    // one-bump-per-version semantics).
    await client.query(
      `UPDATE codebase_blobs SET ref_count = ref_count + 1
       WHERE sha256 IN (
         SELECT value FROM jsonb_each_text(
           (SELECT manifest FROM codebase_versions WHERE chat_id = $1 AND version_number = $2)
         )
       )`,
      [chatId, targetVersion]
    );

    await client.query('COMMIT');

    return Number(inserted.rows[0].version_number);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Day 15 — list a chat's version history (metadata only, no manifests; newest 50 rows).
 * Powers GET /api/chats/:id/versions for the history panel (Days 16-17). Ownership is checked
 * by the calling route via getChatByIdPostgres, same as the latest-version endpoint.
 * Source: ARCHITECTURE-v2.md:450-458; IMPLEMENTATION-PLAN Day 15.
 */
export async function listCodebaseVersionsPostgres(chatId: string): Promise<
  {
    versionNumber: number;
    description: string | null;
    fileCount: number;
    totalBytes: number;
    isLatest: boolean;
    messageId: string | null;
    changeSummary: string | null;
    createdAt: string;
  }[]
> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `SELECT version_number, description, file_count, total_bytes, is_latest, message_id, change_summary, created_at
     FROM codebase_versions
     WHERE chat_id = $1
     ORDER BY version_number DESC
     LIMIT 50`,
    [chatId]
  );

  return result.rows.map(row => ({
    versionNumber: Number(row.version_number),
    description: row.description ?? null,
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    isLatest: Boolean(row.is_latest),
    messageId: row.message_id ?? null,
    changeSummary: row.change_summary ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

/**
 * Day 17 — fetch one specific version's manifest (for restoring the codebase state mapped to
 * a chat message, or previewing an old version). Read-only sibling of
 * getLatestCodebaseVersionPostgres. Returns null when the version does not exist.
 */
export async function getCodebaseVersionPostgres(
  chatId: string,
  versionNumber: number
): Promise<{ versionNumber: number; manifest: Record<string, string> } | null> {
  const pool = getPostgresPool();
  const result = await pool.query(
    'SELECT version_number, manifest FROM codebase_versions WHERE chat_id = $1 AND version_number = $2 LIMIT 1',
    [chatId, versionNumber]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;

  return { versionNumber: Number(row.version_number), manifest };
}

export async function getChatByIdPostgres(
  chatId: string,
  userId: string,
  isModerator?: boolean,
  projectId?: string
): Promise<any | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    if (isModerator) {
      const result = await client.query(
        `
        SELECT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived, c.user_id
        FROM chats c
        WHERE (c.id = $1 OR c.url_id = $1)
          AND ($2::text IS NULL OR c.project_id = $2)
      `,
        [chatId, projectId ?? null]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        ...row,
        messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      };
    }

    // Allow access if user can access the chat or its owning project
    const query = `
      SELECT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived, c.user_id
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1)
        AND ($3::text IS NULL OR c.project_id = $3)
        AND (c.user_id = $2 OR cm.user_id = $2 OR p.owner_user_id = $2 OR pm.user_id = $2)
    `;
    const result = await client.query(query, [chatId, userId, projectId ?? null]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    return {
      ...row,
      messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    };
  } catch (error) {
    console.error('Error fetching chat by ID from PostgreSQL:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function deleteChatPostgres(chatId: string, userId: string): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const query = `
      DELETE FROM chats 
      WHERE id = $1 AND user_id = $2
    `;
    const result = await client.query(query, [chatId, userId]);

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error deleting chat from PostgreSQL:', error);
    return false;
  } finally {
    client.release();
  }
}

// User Activity Functions
export async function logUserActivityPostgres(
  userId: string,
  actionType: string,
  actionDetails: any = {},
  ipAddress?: string,
  userAgent?: string
): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const query = `
      INSERT INTO user_activity (id, user_id, action_type, action_details, ip_address, user_agent, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `;
    const activityId = crypto.randomUUID();
    const result = await client.query(query, [
      activityId,
      userId,
      actionType,
      JSON.stringify(actionDetails),
      ipAddress,
      userAgent,
    ]);

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error logging user activity to PostgreSQL:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getUserActivityPostgres(userId: string, limit: number = 100): Promise<any[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const query = `
      SELECT id, action_type, action_details, ip_address, user_agent, created_at
      FROM user_activity 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    const result = await client.query(query, [userId, limit]);

    return result.rows.map(row => ({
      ...row,
      action_details: typeof row.action_details === 'string' ? JSON.parse(row.action_details) : row.action_details,
    }));
  } catch (error) {
    console.error('Error fetching user activity from PostgreSQL:', error);
    return [];
  } finally {
    client.release();
  }
}

export type ProjectOverviewRecentRun = {
  at: string;
  chatId: string;
  projectId: string;
  /** Prefer this for canonical chat links when present. */
  chatUrlId: string | null;
  projectTitle: string | null;
  totalTokens: number;
  model: string | null;
  provider: string | null;
};

export type ProjectOverview = {
  projectCount: number;
  activeProjectsLast7Days: number;
  tokensLast7Days: number;
  runsLast7Days: number;
  tokenBalanceRemaining: number;
  /** Share of failed-tagged activity vs LLM runs in the last 7 days; null if no denominator. */
  errorRatePercent: number | null;
  failuresLast7Days: number;
  recentRuns: ProjectOverviewRecentRun[];
  healthStatus: 'healthy' | 'attention';
  healthReasons: string[];
};

/** Lightweight dashboard stats for /app/overview (no full chat message payloads). */
export async function getProjectOverviewPostgres(userId: string, isModerator?: boolean): Promise<ProjectOverview> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const empty: ProjectOverview = {
    projectCount: 0,
    activeProjectsLast7Days: 0,
    tokensLast7Days: 0,
    runsLast7Days: 0,
    tokenBalanceRemaining: 0,
    errorRatePercent: null,
    failuresLast7Days: 0,
    recentRuns: [],
    healthStatus: 'healthy',
    healthReasons: [],
  };

  try {
    const now = new Date().toISOString();

    const projectAgg = isModerator
      ? await client.query(
          `SELECT
             COUNT(*)::int AS project_count,
             COUNT(*) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '7 days')::int AS active_7d
           FROM projects p`
        )
      : await client.query(
          `SELECT
             COUNT(DISTINCT p.id)::int AS project_count,
             COUNT(DISTINCT p.id) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '7 days')::int AS active_7d
           FROM projects p
           LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
           WHERE p.owner_user_id = $1 OR pm.user_id = $1`,
          [userId]
        );

    const projectCount = projectAgg.rows[0]?.project_count ?? 0;
    const activeProjectsLast7Days = projectAgg.rows[0]?.active_7d ?? 0;

    const usageAgg = await client.query(
      `SELECT
         COALESCE(SUM(total_tokens), 0)::bigint AS tokens_7d,
         COUNT(*)::int AS runs_7d
       FROM token_usage
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'`,
      [userId]
    );
    const tokensLast7Days = parseInt(String(usageAgg.rows[0]?.tokens_7d ?? 0), 10);
    const runsLast7Days = usageAgg.rows[0]?.runs_7d ?? 0;

    const failAgg = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM user_activity
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'
         AND (
           action_type ILIKE '%error%'
           OR action_type ILIKE '%fail%'
           OR action_type IN ('llm_call_failed', 'chat_stream_error')
         )`,
      [userId]
    );
    const failuresLast7Days = failAgg.rows[0]?.n ?? 0;

    const denom = failuresLast7Days + runsLast7Days;
    const errorRatePercent = denom > 0 ? Math.round((1000 * failuresLast7Days) / denom) / 10 : null;

    const balanceResult = await client.query(
      `SELECT COALESCE(SUM(tokens_allocated - tokens_used), 0)::bigint AS remaining
       FROM token_balances
       WHERE user_id = $1
         AND effective_start <= $2
         AND (effective_end IS NULL OR effective_end >= $2)`,
      [userId, now]
    );
    const tokenBalanceRemaining = parseInt(String(balanceResult.rows[0]?.remaining ?? 0), 10);

    const recent = await client.query(
      `SELECT tu.created_at, tu.chat_id, c.project_id, c.url_id AS chat_url_id, tu.total_tokens, tu.model, tu.provider, c.description
       FROM token_usage tu
       LEFT JOIN chats c ON c.id = tu.chat_id
       WHERE tu.user_id = $1
       ORDER BY tu.created_at DESC
       LIMIT 12`,
      [userId]
    );
    const recentRuns: ProjectOverviewRecentRun[] = recent.rows.map((r: any) => ({
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      chatId: r.chat_id,
      projectId: r.project_id ?? `proj_personal_${userId}`,
      chatUrlId: r.chat_url_id ?? null,
      projectTitle: r.description ?? null,
      totalTokens: parseInt(String(r.total_tokens ?? 0), 10),
      model: r.model ?? null,
      provider: r.provider ?? null,
    }));

    let healthStatus: 'healthy' | 'attention' = 'healthy';
    const healthReasons: string[] = [];

    if (tokenBalanceRemaining === 0 && runsLast7Days > 0) {
      healthStatus = 'attention';
      healthReasons.push('Token balance is empty; add credits or a subscription to continue.');
    }

    if (errorRatePercent !== null && errorRatePercent >= 20) {
      healthStatus = 'attention';
      healthReasons.push(
        `Roughly ${errorRatePercent}% of recent activity matched failure signals (vs recorded LLM runs this week).`
      );
    }

    return {
      projectCount,
      activeProjectsLast7Days,
      tokensLast7Days,
      runsLast7Days,
      tokenBalanceRemaining,
      errorRatePercent,
      failuresLast7Days,
      recentRuns,
      healthStatus,
      healthReasons,
    };
  } catch (error) {
    console.error('Error building project overview:', error);
    return empty;
  } finally {
    client.release();
  }
}

// Chat members and invitations (multi-user project sharing)
export async function getChatMembersPostgres(
  chatId: string,
  requestingUserId: string,
  isModerator?: boolean
): Promise<{ members: { id: string; email: string; role: string }[]; currentUserRole: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    let currentUserRole: string;

    if (isModerator) {
      currentUserRole = 'moderator';
    } else {
      const accessCheck = await client.query(
        `
        SELECT c.user_id as owner_id, cm.role as member_role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `,
        [chatId, requestingUserId]
      );

      if (accessCheck.rows.length === 0) {
        return { members: [], currentUserRole: '' };
      }

      currentUserRole =
        accessCheck.rows[0].owner_id === requestingUserId ? 'owner' : accessCheck.rows[0].member_role || 'member';
    }

    // Get owner from chats
    const chatRow = await client.query(`SELECT user_id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const ownerId = chatRow.rows[0]?.user_id;

    if (!ownerId) {
      return { members: [], currentUserRole: '' };
    }

    const ownerUser = await client.query(`SELECT id, email FROM users WHERE id = $1`, [ownerId]);
    const members: { id: string; email: string; role: string }[] = [];

    if (ownerUser.rows[0]) {
      members.push({ id: ownerUser.rows[0].id, email: ownerUser.rows[0].email, role: 'owner' });
    }

    const memberRows = await client.query(
      `
      SELECT u.id, u.email, cm.role
      FROM chat_members cm
      JOIN users u ON cm.user_id = u.id
      JOIN chats c ON cm.chat_id = c.id
      WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id != $2
    `,
      [chatId, ownerId]
    );

    for (const row of memberRows.rows) {
      members.push({ id: row.id, email: row.email, role: row.role });
    }

    return { members, currentUserRole };
  } catch (error) {
    console.error('Error getting chat members:', error);
    return { members: [], currentUserRole: '' };
  } finally {
    client.release();
  }
}

export async function inviteToChatPostgres(
  chatId: string,
  invitingUserId: string,
  email: string,
  role: string = 'member'
): Promise<{ success: boolean; error?: string; token?: string; alreadyMember?: boolean }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      return { success: false, error: 'Email is required' };
    }

    // Check if chat exists first (so we can give a clear error when project hasn't been saved yet)
    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return {
        success: false,
        error: 'Chat not found. Save your project first (send at least one message) before inviting others.',
      };
    }

    // Check inviter has access (owner or admin)
    const accessCheck = await client.query(
      `
      SELECT cm.role, c.user_id FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
    `,
      [chatId, invitingUserId]
    );

    if (accessCheck.rows.length === 0) {
      return { success: false, error: 'Access denied to this project.' };
    }

    const inviterRole = accessCheck.rows[0].user_id === invitingUserId ? 'owner' : accessCheck.rows[0].role;

    if (inviterRole !== 'owner' && inviterRole !== 'admin') {
      return { success: false, error: 'Only owners and admins can invite' };
    }

    const invitee = await client.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);

    if (invitee.rows[0]) {
      const existingMember = await client.query(`SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [
        resolvedChatId,
        invitee.rows[0].id,
      ]);

      if (existingMember.rows.length > 0) {
        return { success: true, alreadyMember: true };
      }
    }

    const existingInvite = await client.query(
      `SELECT token FROM chat_invitations WHERE chat_id = $1 AND LOWER(email) = $2 AND status = 'pending' AND expires_at > NOW()`,
      [resolvedChatId, normalizedEmail]
    );

    if (existingInvite.rows.length > 0) {
      return { success: false, error: 'Invitation already sent to this email' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await client.query(
      `
      INSERT INTO chat_invitations (id, chat_id, email, invited_by_user_id, role, status, token, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
      ON CONFLICT (chat_id, email) DO UPDATE SET token = $6, expires_at = $7, status = 'pending', invited_by_user_id = $4
    `,
      [crypto.randomUUID(), resolvedChatId, normalizedEmail, invitingUserId, role, token, expiresAt]
    );

    return { success: true, token };
  } catch (error) {
    console.error('Error inviting to chat:', error);
    return { success: false, error: 'Failed to send invitation' };
  } finally {
    client.release();
  }
}

export async function getPendingInvitationsForUserPostgres(userEmail: string): Promise<
  {
    id: string;
    chat_id: string;
    token: string;
    role: string;
    created_at: string;
    project_name: string;
    inviter_email: string;
  }[]
> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const normalizedEmail = userEmail.trim().toLowerCase();
    const result = await client.query(
      `
      SELECT ci.id, ci.chat_id, ci.token, ci.role, ci.created_at,
             COALESCE(c.description, 'Untitled project') as project_name,
             u.email as inviter_email
      FROM chat_invitations ci
      JOIN chats c ON ci.chat_id = c.id
      JOIN users u ON ci.invited_by_user_id = u.id
      WHERE LOWER(ci.email) = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
      ORDER BY ci.created_at DESC
    `,
      [normalizedEmail]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting pending invitations for user:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getChatInvitationsPostgres(
  chatId: string,
  requestingUserId: string
): Promise<{ id: string; email: string; role: string; status: string; created_at: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const accessCheck = await client.query(
      `
      SELECT 1 FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
    `,
      [chatId, requestingUserId]
    );

    if (accessCheck.rows.length === 0) {
      return [];
    }

    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return [];
    }

    const result = await client.query(
      `
      SELECT id, email, role, status, created_at
      FROM chat_invitations
      WHERE chat_id = $1 AND status = 'pending' AND expires_at > NOW()
      ORDER BY created_at DESC
    `,
      [resolvedChatId]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting chat invitations:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function addChatMemberPostgres(chatId: string, userId: string, role: string = 'member'): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return false;
    }

    await client.query(
      `
      INSERT INTO chat_members (id, chat_id, user_id, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (chat_id, user_id) DO UPDATE SET role = $4
    `,
      [crypto.randomUUID(), resolvedChatId, userId, role]
    );

    return true;
  } catch (error) {
    console.error('Error adding chat member:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateChatMemberRolePostgres(
  chatId: string,
  requestingUserId: string,
  targetUserId: string,
  newRole: string,
  isModerator?: boolean
): Promise<{ success: boolean; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    if (!['admin', 'member'].includes(newRole)) {
      return { success: false, error: 'Invalid role' };
    }

    const chatRow = await client.query(`SELECT id, user_id as owner_id FROM chats WHERE id = $1 OR url_id = $1`, [
      chatId,
    ]);
    const ownerId = chatRow.rows[0]?.owner_id;

    if (!ownerId) {
      return { success: false, error: 'Chat not found' };
    }

    if (targetUserId === ownerId) {
      return { success: false, error: 'Cannot change owner role' };
    }

    let requesterRole: string;

    if (isModerator) {
      requesterRole = 'owner';
    } else {
      const accessCheck = await client.query(
        `
        SELECT c.user_id, cm.role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `,
        [chatId, requestingUserId]
      );

      if (accessCheck.rows.length === 0) {
        return { success: false, error: 'Access denied' };
      }

      requesterRole = accessCheck.rows[0].user_id === requestingUserId ? 'owner' : accessCheck.rows[0].role || 'member';
    }

    if (requesterRole === 'member') {
      return { success: false, error: 'Only owners and admins can edit roles' };
    }

    if (requesterRole === 'admin') {
      const targetMember = await client.query(
        `SELECT role FROM chat_members cm JOIN chats c ON cm.chat_id = c.id WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id = $2`,
        [chatId, targetUserId]
      );

      if (targetMember.rows[0]?.role === 'admin') {
        return { success: false, error: "Only the owner can change an admin's role" };
      }
    }

    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return { success: false, error: 'Chat not found' };
    }

    await client.query(`UPDATE chat_members SET role = $3 WHERE chat_id = $1 AND user_id = $2`, [
      resolvedChatId,
      targetUserId,
      newRole,
    ]);

    return { success: true };
  } catch (error) {
    console.error('Error updating member role:', error);
    return { success: false, error: 'Failed to update role' };
  } finally {
    client.release();
  }
}

export async function removeChatMemberPostgres(
  chatId: string,
  requestingUserId: string,
  targetUserId: string,
  isModerator?: boolean
): Promise<{ success: boolean; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const chatRow = await client.query(`SELECT id, user_id as owner_id FROM chats WHERE id = $1 OR url_id = $1`, [
      chatId,
    ]);
    const ownerId = chatRow.rows[0]?.owner_id;
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!ownerId || !resolvedChatId) {
      return { success: false, error: 'Chat not found' };
    }

    if (targetUserId === ownerId) {
      return { success: false, error: 'Cannot remove the project owner' };
    }

    let requesterRole: string;

    if (isModerator) {
      requesterRole = 'owner';
    } else {
      const accessCheck = await client.query(
        `
        SELECT c.user_id, cm.role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `,
        [chatId, requestingUserId]
      );

      if (accessCheck.rows.length === 0) {
        return { success: false, error: 'Access denied' };
      }

      requesterRole = accessCheck.rows[0].user_id === requestingUserId ? 'owner' : accessCheck.rows[0].role || 'member';
    }

    if (requesterRole === 'member') {
      return { success: false, error: 'Only owners and admins can remove members' };
    }

    if (requesterRole === 'admin') {
      const targetMember = await client.query(
        `SELECT role FROM chat_members cm JOIN chats c ON cm.chat_id = c.id WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id = $2`,
        [chatId, targetUserId]
      );

      if (targetMember.rows[0]?.role === 'admin') {
        return { success: false, error: 'Only the owner can remove an admin' };
      }
    }

    await client.query(`DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [resolvedChatId, targetUserId]);

    return { success: true };
  } catch (error) {
    console.error('Error removing member:', error);
    return { success: false, error: 'Failed to remove member' };
  } finally {
    client.release();
  }
}

export async function acceptInvitationByTokenPostgres(
  token: string,
  userId: string,
  userEmail: string
): Promise<{ success: boolean; chatUrl?: string; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const normalizedEmail = userEmail.trim().toLowerCase();
    const invResult = await client.query(
      `
      SELECT ci.id, ci.chat_id, ci.email, ci.role, c.url_id
      FROM chat_invitations ci
      JOIN chats c ON ci.chat_id = c.id
      WHERE ci.token = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
    `,
      [token]
    );

    if (invResult.rows.length === 0) {
      return { success: false, error: 'Invitation not found or expired' };
    }

    const inv = invResult.rows[0];

    if (inv.email.toLowerCase() !== normalizedEmail) {
      return { success: false, error: 'This invitation was sent to a different email address' };
    }

    await client.query(`UPDATE chat_invitations SET status = 'accepted' WHERE id = $1`, [inv.id]);
    await addChatMemberPostgres(inv.chat_id, userId, inv.role);

    return { success: true, chatUrl: buildProjectChatPath(DEFAULT_PROJECT_ID, inv.url_id || inv.chat_id) };
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return { success: false, error: 'Failed to accept invitation' };
  } finally {
    client.release();
  }
}

/*
 * ============================================================
 * Phase 2: Company (Tenant) Functions
 * ============================================================
 */

export type CompanyRole = 'admin' | 'developer' | 'viewer';
export type AppStatus = 'draft' | 'building' | 'active' | 'sleeping' | 'failed';
export type RuntimeType = 'static' | 'worker' | 'container';

export type Company = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  github_org: string | null;
  owner_user_id: string | null;
  created_at: string;
};

export type CompanyApp = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: AppStatus;
  runtime_type: RuntimeType;
  github_repo: string | null;
  deploy_url: string | null;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function createCompanyPostgres(
  name: string,
  slug: string,
  ownerUserId: string,
  githubOrg?: string
): Promise<Company | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const companyId = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO companies (id, name, slug, owner_user_id, github_org)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [companyId, name, slug, ownerUserId, githubOrg ?? null]
    );
    await client.query(
      `INSERT INTO company_members (id, company_id, user_id, role)
       VALUES ($1, $2, $3, 'admin')`,
      [crypto.randomUUID(), companyId, ownerUserId]
    );
    await client.query('COMMIT');

    return result.rows[0] ?? null;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Error creating company:', error);

    return null;
  } finally {
    client.release();
  }
}

export async function getCompanyBySlugPostgres(slug: string): Promise<Company | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(`SELECT * FROM companies WHERE slug = $1 LIMIT 1`, [slug]);
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error getting company by slug:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getUserCompaniesPostgres(userId: string): Promise<(Company & { role: CompanyRole })[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT c.*, cm.role
       FROM companies c
       JOIN company_members cm ON c.id = cm.company_id
       WHERE cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting user companies:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getCompanyMemberPostgres(
  companyId: string,
  userId: string
): Promise<{ role: CompanyRole } | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2 LIMIT 1`,
      [companyId, userId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error getting company member:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getCompanyMembersPostgres(
  companyId: string
): Promise<{ user_id: string; email: string; role: CompanyRole; joined_at: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT cm.user_id, u.email, cm.role, cm.joined_at
       FROM company_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.company_id = $1
       ORDER BY cm.joined_at ASC`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting company members:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function addCompanyMemberPostgres(companyId: string, userId: string, role: CompanyRole): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `INSERT INTO company_members (id, company_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [crypto.randomUUID(), companyId, userId, role]
    );
    return true;
  } catch (error) {
    console.error('Error adding company member:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function removeCompanyMemberPostgres(companyId: string, userId: string): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(`DELETE FROM company_members WHERE company_id = $1 AND user_id = $2`, [companyId, userId]);
    return true;
  } catch (error) {
    console.error('Error removing company member:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateCompanyPostgres(
  companyId: string,
  fields: { name?: string; github_org?: string; plan?: string }
): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: unknown[] = [];
    let idx = 1;

    if (fields.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(fields.name);
    }

    if (fields.github_org !== undefined) {
      setClauses.push(`github_org = $${idx++}`);
      values.push(fields.github_org);
    }

    if (fields.plan !== undefined) {
      setClauses.push(`plan = $${idx++}`);
      values.push(fields.plan);
    }

    if (values.length === 0) {
      return true;
    }

    values.push(companyId);
    await client.query(`UPDATE companies SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);

    return true;
  } catch (error) {
    console.error('Error updating company:', error);
    return false;
  } finally {
    client.release();
  }
}

/*
 * ============================================================
 * Phase 2: Company App Functions
 * ============================================================
 */

export async function getCompanyAppsPostgres(companyId: string): Promise<CompanyApp[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT id, name, slug, description, status, runtime_type, github_repo,
              deploy_url, last_active_at, created_at, updated_at
       FROM projects
       WHERE company_id = $1 AND is_archived = FALSE
       ORDER BY
         CASE status
           WHEN 'active'   THEN 1
           WHEN 'building' THEN 2
           WHEN 'sleeping' THEN 3
           WHEN 'draft'    THEN 4
           WHEN 'failed'   THEN 5
         END,
         updated_at DESC`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting company apps:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function updateAppStatusPostgres(
  projectId: string,
  status: AppStatus,
  extra?: { deploy_url?: string; github_repo?: string; build_logs?: string }
): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const setClauses = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const values: unknown[] = [status];
    let idx = 2;

    if (status === 'active') {
      setClauses.push(`last_active_at = CURRENT_TIMESTAMP`);
    }

    if (extra?.deploy_url) {
      setClauses.push(`deploy_url = $${idx++}`);
      values.push(extra.deploy_url);
    }

    if (extra?.github_repo) {
      setClauses.push(`github_repo = $${idx++}`);
      values.push(extra.github_repo);
    }

    if (extra?.build_logs !== undefined) {
      setClauses.push(`build_logs = $${idx++}`);
      values.push(extra.build_logs);
    }

    values.push(projectId);
    await client.query(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);

    return true;
  } catch (error) {
    console.error('Error updating app status:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getInactiveAppsPostgres(thresholdMinutes = 15): Promise<{ id: string; company_id: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT id, company_id FROM projects
       WHERE status = 'active'
         AND runtime_type = 'container'
         AND last_active_at < NOW() - ($1 || ' minutes')::INTERVAL`,
      [thresholdMinutes]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting inactive apps:', error);
    return [];
  } finally {
    client.release();
  }
}

/*
 * ============================================================
 * Phase 2: Audit Log Functions
 * ============================================================
 */

export type AuditAction =
  | 'CREATE_COMPANY'
  | 'UPDATE_COMPANY'
  | 'MEMBER_ADD'
  | 'MEMBER_REMOVE'
  | 'MEMBER_ROLE_CHANGE'
  | 'CREATE_APP'
  | 'DELETE_APP'
  | 'BUILD'
  | 'DEPLOY'
  | 'PUSH_CODE'
  | 'WAKE'
  | 'SLEEP';

export async function addAuditLogPostgres(params: {
  companyId: string;
  actorId: string;
  projectId?: string | null;
  action: AuditAction;
  payload?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `INSERT INTO audit_logs (id, company_id, actor_id, project_id, action, payload, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(),
        params.companyId,
        params.actorId,
        params.projectId ?? null,
        params.action,
        params.payload ? JSON.stringify(params.payload) : null,
        params.ipAddress ?? null,
      ]
    );
    return true;
  } catch (error) {
    console.error('Error adding audit log:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getAuditLogsPostgres(
  companyId: string,
  limit = 50
): Promise<
  {
    id: string;
    actor_email: string;
    project_name: string | null;
    action: string;
    payload: unknown;
    created_at: string;
  }[]
> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT al.id, u.email as actor_email, p.name as project_name,
              al.action, al.payload, al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON al.actor_id = u.id
       LEFT JOIN projects p ON al.project_id = p.id
       WHERE al.company_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return [];
  } finally {
    client.release();
  }
}
