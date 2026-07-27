-- ============================================================================
-- Prompify in-place upgrade — DBeaver script (READ-ONLY except where noted)
-- Run sections A & B BEFORE the maintenance window.
-- Run section C AFTER the new app has booted.
-- Nothing here writes data except the clearly-marked OPTIONAL remediation in B3.
-- ============================================================================


-- ============================================================================
-- SECTION A — BASELINE ("before" numbers to compare against after upgrade)
-- ============================================================================

SELECT count(*) AS total_users        FROM users;
SELECT count(*) AS total_chats        FROM chats;
SELECT count(*) AS total_projects     FROM projects;

-- chats currently missing a project (becomes 0 after upgrade)
SELECT count(*) AS chats_without_project
FROM chats
WHERE project_id IS NULL;
-- NOTE: if the column doesn't exist yet on old prod, this errors — that's fine.


-- ============================================================================
-- SECTION B — PREFLIGHT (the boot migration will FAIL if these aren't clean)
-- ============================================================================

-- B1. Orphan chats: user_id points to a non-existent user.
--     The boot backfill can't assign these a project -> SET NOT NULL throws
--     -> createPostgresTables() aborts before creating later tables.
--     THIS MUST RETURN 0.
SELECT count(*) AS orphan_chats_bad_user
FROM chats c
LEFT JOIN users u ON c.user_id = u.id
WHERE u.id IS NULL;

-- B2. Chats with a NULL user_id (also unbackfillable). MUST RETURN 0.
SELECT count(*) AS chats_null_user
FROM chats
WHERE user_id IS NULL;

-- B2b. If B1 > 0, list the offenders so we can decide what to do with them.
SELECT c.id AS chat_id, c.user_id, c.url_id
FROM chats c
LEFT JOIN users u ON c.user_id = u.id
WHERE u.id IS NULL
ORDER BY c.user_id;

-- B3. OPTIONAL REMEDIATION (WRITES DATA — do NOT run without boss sign-off).
--     Only if B1/B2 return > 0 and you've decided these orphan chats are junk.
--     Review B2b output first. Leave commented until explicitly approved.
--
-- DELETE FROM chats c
-- WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)
--    OR c.user_id IS NULL;


-- ============================================================================
-- SECTION C — POST-UPGRADE VERIFICATION (run AFTER new app has booted)
-- ============================================================================

-- C1. Every chat now has a project. MUST RETURN 0.
SELECT count(*) AS chats_still_null_project
FROM chats
WHERE project_id IS NULL;

-- C2. Personal projects were created for existing users. MUST RETURN > 0.
SELECT count(*) AS personal_projects
FROM projects
WHERE id LIKE 'proj_personal_%';

-- C3. New tables exist (non-NULL = created).
SELECT
  to_regclass('codebase_versions') AS codebase_versions,
  to_regclass('codebase_blobs')    AS codebase_blobs,
  to_regclass('app_tables')        AS app_tables,
  to_regclass('companies')         AS companies,
  to_regclass('company_members')   AS company_members;

-- C4. New columns exist on codebase_versions (change_summary was the historical miss).
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'codebase_versions'
  AND column_name IN ('change_summary', 'message_id')
ORDER BY column_name;

-- C5. project_id is now NOT NULL (the migration completed fully). Expect 'NO'.
SELECT is_nullable
FROM information_schema.columns
WHERE table_name = 'chats' AND column_name = 'project_id';

-- C6. Subscription tiers seeded.
SELECT id, name, display_name FROM subscription_tiers ORDER BY sort_order;
