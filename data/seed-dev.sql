-- Dev-only database seed (Risk R9). Mounted ONLY by docker-compose.dev.yaml, never by
-- docker-compose.prod.yaml — so this privileged row never lands in production.
--
-- Why: when AUTH_DISABLED=true (the dev default), requireAuth() returns the mock user
-- getMockAdminUser() => id 'admin-bypass' (app/lib/auth.ts). No code path ever INSERTs that
-- row, so the first DB write that references it (ensureDefaultProjectForUser inserting a
-- project with owner_user_id='admin-bypass') fails the users FK and every chat save 500s.
-- Seeding the row here makes a fresh dev volume work with zero manual SQL.
--
-- Ordering: the Postgres docker entrypoint runs /docker-entrypoint-initdb.d/*.sql in POSIX
-- filename order. 'seed-dev.sql' sorts after 'init-db.sql' ('s' > 'i'), so the users table
-- created by init-db.sql already exists when this runs. Both run only on first init.
--
-- password_hash is a non-functional placeholder: this identity is only ever used when auth is
-- bypassed; it can never be logged into via password. is_moderator mirrors getMockAdminUser().
INSERT INTO users (id, email, password_hash, is_verified, is_moderator)
VALUES ('admin-bypass', 'admin@bypass.local', 'AUTH_DISABLED_NO_PASSWORD_LOGIN', true, true)
ON CONFLICT (id) DO NOTHING;
