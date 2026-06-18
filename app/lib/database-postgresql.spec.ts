import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Verifies the free-token grant wiring for the EulerOS billing flow:
 *  - A new, already-verified account (email verification OFF) is granted 150K at signup.
 *  - An unverified account is NOT granted at signup (verifyUser grants later).
 *  - The grant is idempotent: skipped when a tier balance already exists.
 *  - The idempotency-hole fix: still grants when the *subscription* row already exists.
 *
 * `pg` is mocked with a fake client that records every query and returns canned results,
 * so the real createUserPostgres logic runs without any database.
 */

const state = vi.hoisted(() => ({
  calls: [] as { sql: string; params: any[] }[],
  existingTierBalance: false,
  subAlreadyExists: false,
}));

vi.mock('pg', () => {
  class FakePoolClient {
    async query(sql: string, params: any[] = []) {
      state.calls.push({ sql, params });

      if (/INSERT INTO users/i.test(sql)) {
        return { rowCount: 1, rows: [] };
      }

      if (/INSERT INTO subscriptions/i.test(sql)) {
        // ON CONFLICT DO NOTHING RETURNING id -> 0 rows when one already exists.
        return state.subAlreadyExists ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: 'sub_new' }] };
      }

      if (/SELECT id FROM subscriptions/i.test(sql)) {
        return { rows: [{ id: 'sub_existing' }] };
      }

      if (/SELECT 1 FROM token_balances/i.test(sql)) {
        return { rows: state.existingTierBalance ? [{ '?column?': 1 }] : [] };
      }

      if (/SELECT limits FROM subscription_tiers/i.test(sql)) {
        return { rows: [{ limits: { tokens: 150000 } }] };
      }

      // companies / company_members / token_balances inserts, etc.
      return { rowCount: 1, rows: [] };
    }
    release() {}
  }

  class FakePool {
    on() {}
    async connect() {
      return new FakePoolClient();
    }
    async query(sql: string, params: any[] = []) {
      return new FakePoolClient().query(sql, params);
    }
  }

  return { default: { Pool: FakePool } };
});

import { createUserPostgres } from './database-postgresql';

const grantInsert = () =>
  state.calls.find(c => /INSERT INTO token_balances/i.test(c.sql) && /'tier'/i.test(c.sql));

const makeUser = (overrides: Record<string, any>) => ({
  id: 'u',
  email: 'a@b.c',
  passwordHash: 'hash',
  isVerified: false,
  verificationToken: null,
  verificationExpires: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test/test';
  state.calls = [];
  state.existingTierBalance = false;
  state.subAlreadyExists = false;
});

describe('createUserPostgres — free-token grant', () => {
  it('grants 150K when the account is created already-verified (email verification OFF)', async () => {
    const ok = await createUserPostgres(makeUser({ id: 'u1', isVerified: true }));

    expect(ok).toBe(true);

    const grant = grantInsert();
    expect(grant).toBeTruthy();
    // grant params: [balanceId, userId, companyId, subId, tokens, start, end]
    expect(grant!.params[1]).toBe('u1');
    expect(grant!.params[4]).toBe(150000);
  });

  it('does NOT grant at creation for an unverified account (grant happens on verify)', async () => {
    const ok = await createUserPostgres(makeUser({ id: 'u2', isVerified: false, verificationToken: 'tok' }));

    expect(ok).toBe(true);
    expect(grantInsert()).toBeUndefined();
  });

  it('is idempotent — skips the grant when a tier balance already exists', async () => {
    state.existingTierBalance = true;

    await createUserPostgres(makeUser({ id: 'u3', isVerified: true }));

    expect(grantInsert()).toBeUndefined();
  });

  it('still grants when the subscription row already exists (idempotency-hole fix)', async () => {
    state.subAlreadyExists = true; // subscription INSERT returns 0 rows

    await createUserPostgres(makeUser({ id: 'u4', isVerified: true }));

    const grant = grantInsert();
    expect(grant).toBeTruthy();
    expect(grant!.params[3]).toBe('sub_existing'); // subId resolved from the SELECT fallback
    expect(grant!.params[4]).toBe(150000);
  });
});
