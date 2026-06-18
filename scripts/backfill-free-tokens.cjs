#!/usr/bin/env node
/**
 * Backfill the free-tier (150K) token grant for existing accounts that never received
 * one. This heals accounts created before the signup-grant fix — chiefly accounts made
 * while email verification was OFF, which never hit the verify-time grant path and so
 * ended up with a personal company/project but no subscription and no token balance.
 *
 * Idempotent and safe to re-run: it only provisions what's missing and never double-grants
 * (gated on whether an active-period 'tier' balance already exists).
 *
 * Usage:
 *   node scripts/backfill-free-tokens.cjs            # DRY RUN — reports what it would do
 *   node scripts/backfill-free-tokens.cjs --apply    # actually writes, in one transaction
 *
 * Requires DATABASE_URL (read from .env). Run it where the DB is reachable (e.g. inside
 * the Docker network if the host is the `postgres` service).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

  let client;

  try {
    client = await pool.connect();
  } catch (err) {
    const host = (connectionString.match(/@([^:/?]+)/) || [])[1] || '(unknown)';
    console.error(`Could not connect to the database at host "${host}".`);
    console.error('Run this script where that host resolves (e.g. inside the Docker network).');
    await pool.end();
    process.exit(1);
  }

  try {
    // The default free allocation — read from the tier so it stays in sync with the seed.
    const tierRes = await client.query(`SELECT limits FROM subscription_tiers WHERE id = 'tier_trial'`);
    const tokens = Number(tierRes.rows[0]?.limits?.tokens ?? 150000);

    // Who is missing a tier balance? (verified accounts only — unverified aren't "usable" yet)
    const affected = await client.query(`
      SELECT u.id, u.email
      FROM users u
      WHERE u.is_verified = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM token_balances b
          WHERE b.company_id = 'cmp_personal_' || u.id AND b.source = 'tier'
        )
      ORDER BY u.created_at
    `);

    console.log(`Tier grant amount: ${tokens.toLocaleString()} tokens`);
    console.log(`Accounts missing a free-tier balance: ${affected.rowCount}`);
    affected.rows.slice(0, 50).forEach(r => console.log(`  - ${r.email} (${r.id})`));
    if (affected.rowCount > 50) console.log(`  ... and ${affected.rowCount - 50} more`);

    if (affected.rowCount === 0) {
      console.log('Nothing to backfill.');
      return;
    }

    if (!APPLY) {
      console.log('\nDRY RUN — no changes written. Re-run with --apply to grant these.');
      return;
    }

    await client.query('BEGIN');

    // 1. Ensure a personal company + owner membership (matches ensurePersonalCompanyWithClient).
    await client.query(`
      INSERT INTO companies (id, name, slug, plan, is_personal, seats, owner_user_id)
      SELECT 'cmp_personal_' || u.id, 'Personal', 'personal-' || u.id, 'free', TRUE, 1, u.id
      FROM users u WHERE u.is_verified = TRUE
      ON CONFLICT (id) DO NOTHING
    `);
    await client.query(`
      INSERT INTO company_members (id, company_id, user_id, role)
      SELECT 'cmpm_personal_' || u.id, 'cmp_personal_' || u.id, u.id, 'owner'
      FROM users u WHERE u.is_verified = TRUE
      ON CONFLICT (company_id, user_id) DO NOTHING
    `);

    // 2. Ensure a Trial subscription per personal company.
    await client.query(`
      INSERT INTO subscriptions (id, user_id, company_id, tier_id, status, current_period_start, current_period_end)
      SELECT 'sub_personal_' || c.owner_user_id, c.owner_user_id, c.id, 'tier_trial', 'active',
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 month'
      FROM companies c WHERE c.is_personal = TRUE
      ON CONFLICT (company_id) DO NOTHING
    `);

    // 3. Grant a tier balance to every personal company that still lacks one.
    const granted = await client.query(
      `
      INSERT INTO token_balances
        (id, user_id, company_id, source, source_reference_id, tokens_allocated, tokens_used, effective_start, effective_end)
      SELECT 'bal_backfill_' || c.id, c.owner_user_id, c.id, 'tier', s.id, $1, 0,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 month'
      FROM companies c
      JOIN subscriptions s ON s.company_id = c.id
      WHERE c.is_personal = TRUE
        AND NOT EXISTS (SELECT 1 FROM token_balances b WHERE b.company_id = c.id AND b.source = 'tier')
      ON CONFLICT (id) DO NOTHING
    `,
      [tokens]
    );

    await client.query('COMMIT');
    console.log(`\nGranted ${granted.rowCount} tier balance(s) of ${tokens.toLocaleString()} tokens. Done.`);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('Backfill failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
