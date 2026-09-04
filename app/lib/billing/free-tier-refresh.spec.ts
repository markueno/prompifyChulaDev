import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Free-tier monthly renewal.
 *
 * The properties that matter (each is a way real users lose tokens if it breaks):
 *  - A lapsed free workspace is granted again, keeping its original renewal day.
 *  - Dormancy grants ONCE, not once per month missed.
 *  - Unused tokens carry over, but only up to the CARRY_CAP_MONTHS ceiling.
 *  - Forfeiting withdraws the allocation rather than inflating usage (analytics stay honest).
 *  - Carry-over only picks up rows that lapsed with the period, never ones force-expired
 *    at cancellation — otherwise churned customers get their paid tokens back for free.
 *  - Paid workspaces are never selected; churned ones (old stripe id, free tier) ARE.
 *  - Grant happens before the period rolls, so a crash between them can't starve an account.
 *  - Dry run writes nothing and sends nothing.
 */

const state = vi.hoisted(() => ({
  calls: [] as { sql: string; params: any[] }[],
  candidates: [] as any[],
  /** Rows returned as carry candidates: what lapsed with the previous period. */
  carryRows: [] as { id: string; unused: number }[],
  /** Company id whose writes should blow up, to prove one bad row can't abort the batch. */
  failWritesFor: null as string | null,
}));

const sendWarning = vi.hoisted(() => vi.fn(async () => true));

vi.mock('~/lib/email', () => ({ sendTokenCarryOverWarningEmail: sendWarning }));

vi.mock('pg', () => {
  class FakePool {
    on() {}
    async connect() {
      return { query: this.query.bind(this), release() {} };
    }
    async query(sql: string, params: any[] = []) {
      state.calls.push({ sql, params });

      if (/FROM subscriptions/i.test(sql) && /SELECT/i.test(sql)) {
        return { rows: state.candidates, rowCount: state.candidates.length };
      }

      if (/SELECT id, \(tokens_allocated - tokens_used\)/i.test(sql)) {
        return { rows: state.carryRows, rowCount: state.carryRows.length };
      }

      if (state.failWritesFor && params.includes(state.failWritesFor) && /^\s*(INSERT|UPDATE)/i.test(sql)) {
        throw new Error('null value in column "user_id" violates not-null constraint');
      }

      return { rows: [], rowCount: 1 };
    }
  }

  return { default: { Pool: FakePool } };
});

import {
  refreshFreeTierAllocations,
  nextPeriodFor,
  CARRY_CAP_MONTHS,
  MAX_CARRYOVER_WARNINGS,
} from './free-tier-refresh.server';

const find = (re: RegExp) => state.calls.filter(c => re.test(c.sql));
const grantInsert = () => find(/INSERT INTO token_balances/i);
const periodUpdate = () => find(/UPDATE subscriptions[\s\S]*current_period_start/i);
const carryUpdate = () => find(/UPDATE token_balances SET effective_end/i);
const forfeitUpdate = () => find(/SET tokens_allocated = tokens_used/i);
const warningIncrement = () => find(/carryover_warnings_sent = carryover_warnings_sent \+ 1/i);
const warningReset = () => find(/carryover_warnings_sent = 0/i);

const MONTHLY = 150_000;

/** Two full months banked = the carry budget is exactly full, so the account is at the ceiling. */
const saturatedRows = () => [
  { id: 'bal_new', unused: MONTHLY },
  { id: 'bal_mid', unused: MONTHLY },
];

beforeEach(() => {
  state.calls = [];
  state.failWritesFor = null;
  state.carryRows = [];
  state.candidates = [
    {
      company_id: 'cmp_a',
      user_id: 'u_a',
      subscription_id: 'sub_a',
      current_period_end: '2026-07-15T00:00:00.000Z',
      email: 'a@example.com',
      carryover_warnings_sent: 0,
    },
  ];
  sendWarning.mockClear();
  sendWarning.mockResolvedValue(true);
});

describe('nextPeriodFor', () => {
  const now = new Date('2026-08-19T10:00:00.000Z');

  it('rolls a just-lapsed period to the next month, keeping the renewal day', () => {
    const { start, end } = nextPeriodFor(new Date('2026-08-15T00:00:00.000Z'), now);
    expect(start.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('grants once after long dormancy, not once per month missed', () => {
    const { start, end } = nextPeriodFor(new Date('2025-12-15T00:00:00.000Z'), now);
    expect(start.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('starts a fresh window when the period end is missing', () => {
    const { start, end } = nextPeriodFor(null, now);
    expect(start).toEqual(now);
    expect(end.toISOString()).toBe('2026-09-19T10:00:00.000Z');
  });
});

describe('refreshFreeTierAllocations', () => {
  it('only ever selects the free tier', async () => {
    await refreshFreeTierAllocations({ dryRun: false });

    const select = find(/FROM subscriptions/i).find(c => /SELECT/i.test(c.sql))!;
    expect(select.params[0]).toBe('tier_trial');

    // Selecting on the stripe id would starve churned accounts — it must not appear.
    expect(select.sql).not.toMatch(/stripe_subscription_id/i);
  });

  it('grants the free allocation and rolls the period, in that order', async () => {
    const result = await refreshFreeTierAllocations({ dryRun: false });

    expect(result.mode).toBe('applied');
    expect(result.refreshed).toBe(1);

    const grant = grantInsert()[0];
    expect(grant.params).toContain(MONTHLY);
    expect(grant.sql).toMatch(/'tier'/);

    expect(state.calls.indexOf(grant)).toBeLessThan(state.calls.indexOf(periodUpdate()[0]));
  });

  it('keys the grant on the period so a re-run inside the same period cannot double-credit', async () => {
    await refreshFreeTierAllocations({ dryRun: false });

    expect(grantInsert()[0].params[0]).toBe('bal_free_cmp_a_2026-08-15');
    expect(grantInsert()[0].sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
  });

  it('only considers rows that lapsed with the previous period', async () => {
    await refreshFreeTierAllocations({ dryRun: false });

    // Force-expired rows from a cancellation carry a different timestamp and must not match.
    const select = find(/SELECT id, \(tokens_allocated - tokens_used\)/i)[0];
    expect(select.sql).toMatch(/effective_end = \$2/);
    expect(select.params[1]).toBe('2026-07-15T00:00:00.000Z');
  });

  describe('carry-over cap', () => {
    it('carries everything when under the ceiling', async () => {
      state.carryRows = [{ id: 'bal_1', unused: 100_000 }];

      const result = await refreshFreeTierAllocations({ dryRun: false });

      expect(result.carriedTokens).toBe(100_000);
      expect(result.forfeitedTokens).toBe(0);
      expect(carryUpdate()).toHaveLength(1);
      expect(forfeitUpdate()).toHaveLength(0);
    });

    it(`stops at ${CARRY_CAP_MONTHS} months total and forfeits the excess`, async () => {
      // Three full months already banked; budget is two months (the third is the incoming grant).
      state.carryRows = [
        { id: 'bal_new', unused: MONTHLY },
        { id: 'bal_mid', unused: MONTHLY },
        { id: 'bal_old', unused: MONTHLY },
      ];

      const result = await refreshFreeTierAllocations({ dryRun: false });

      expect(result.carriedTokens).toBe(MONTHLY * (CARRY_CAP_MONTHS - 1));
      expect(result.forfeitedTokens).toBe(MONTHLY);

      // Newest survive, oldest is dropped.
      expect(carryUpdate()[0].params[0]).toEqual(['bal_new', 'bal_mid']);
      expect(forfeitUpdate()[0].params[0]).toEqual(['bal_old']);
    });

    it('forfeits by withdrawing the allocation, never by inflating usage', async () => {
      state.carryRows = [
        { id: 'bal_new', unused: MONTHLY },
        { id: 'bal_mid', unused: MONTHLY },
        { id: 'bal_old', unused: MONTHLY },
      ];

      await refreshFreeTierAllocations({ dryRun: false });

      const forfeit = forfeitUpdate()[0];
      expect(forfeit.sql).toMatch(/SET tokens_allocated = tokens_used/);
      expect(forfeit.sql).not.toMatch(/tokens_used\s*=\s*tokens_used\s*\+/);
    });
  });

  describe('warning email', () => {
    it('warns when the ceiling is reached, before anything is lost', async () => {
      state.carryRows = saturatedRows();

      const result = await refreshFreeTierAllocations({ dryRun: false });

      expect(result.warned).toBe(1);
      expect(sendWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@example.com',
          forfeitedTokens: 0,
          capTokens: MONTHLY * CARRY_CAP_MONTHS,
          warningNumber: 1,
          finalWarning: false,
        })
      );
      expect(warningIncrement()).toHaveLength(1);
    });

    it('does not warn an account that is nowhere near the ceiling', async () => {
      state.carryRows = [{ id: 'bal_1', unused: 10_000 }];

      await refreshFreeTierAllocations({ dryRun: false });

      expect(sendWarning).not.toHaveBeenCalled();
    });

    it(`goes quiet after ${MAX_CARRYOVER_WARNINGS} warnings so a dormant account is not nagged forever`, async () => {
      state.carryRows = saturatedRows();
      state.candidates[0].carryover_warnings_sent = MAX_CARRYOVER_WARNINGS;

      const result = await refreshFreeTierAllocations({ dryRun: false });

      expect(sendWarning).not.toHaveBeenCalled();
      expect(result.warned).toBe(0);

      // The refresh itself carries on regardless — silence is about email, not tokens.
      expect(result.refreshed).toBe(1);
      expect(grantInsert()).toHaveLength(1);
      expect(carryUpdate()).toHaveLength(1);
    });

    it('marks the last one as final so the reader knows the reminders stop', async () => {
      state.carryRows = saturatedRows();
      state.candidates[0].carryover_warnings_sent = MAX_CARRYOVER_WARNINGS - 1;

      await refreshFreeTierAllocations({ dryRun: false });

      expect(sendWarning).toHaveBeenCalledWith(
        expect.objectContaining({ warningNumber: MAX_CARRYOVER_WARNINGS, finalWarning: true })
      );
    });

    it('clears the streak once the account drops back under the ceiling', async () => {
      state.carryRows = [{ id: 'bal_1', unused: 10_000 }];
      state.candidates[0].carryover_warnings_sent = MAX_CARRYOVER_WARNINGS;

      await refreshFreeTierAllocations({ dryRun: false });

      expect(warningReset()).toHaveLength(1);
      expect(warningReset()[0].params).toContain('cmp_a');
    });

    it('does not count a warning that failed to send, so it retries next month', async () => {
      state.carryRows = saturatedRows();
      sendWarning.mockRejectedValueOnce(new Error('resend down'));

      const result = await refreshFreeTierAllocations({ dryRun: false });

      expect(result.refreshed).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.warned).toBe(0);
      expect(grantInsert()).toHaveLength(1);
      expect(warningIncrement()).toHaveLength(0);
    });
  });

  it('writes nothing and sends nothing on a dry run', async () => {
    state.carryRows = [{ id: 'bal_1', unused: 40_000 }];

    const result = await refreshFreeTierAllocations();

    expect(result.mode).toBe('dry-run');
    expect(result.due).toBe(1);
    expect(result.preview?.[0]).toMatchObject({ grant: MONTHLY, carriedOver: 40_000, newTotal: 190_000 });

    expect(grantInsert()).toHaveLength(0);
    expect(periodUpdate()).toHaveLength(0);
    expect(carryUpdate()).toHaveLength(0);
    expect(forfeitUpdate()).toHaveLength(0);
    expect(sendWarning).not.toHaveBeenCalled();
  });

  it('keeps going when one workspace fails, and leaves it due for the next run', async () => {
    state.candidates = [
      {
        company_id: 'cmp_a',
        user_id: null,
        subscription_id: 'sub_a',
        current_period_end: '2026-07-15T00:00:00.000Z',
        email: null,
      },
      {
        company_id: 'cmp_b',
        user_id: 'u_b',
        subscription_id: 'sub_b',
        current_period_end: '2026-07-15T00:00:00.000Z',
        email: 'b@example.com',
      },
    ];
    state.failWritesFor = 'cmp_a';

    const result = await refreshFreeTierAllocations({ dryRun: false });

    expect(result.failed).toBe(1);
    expect(result.refreshed).toBe(1);

    // The healthy workspace still got its grant...
    expect(grantInsert().some(c => c.params.includes('cmp_b'))).toBe(true);

    // ...and the broken one's period was NOT rolled, so it stays due rather than being skipped.
    expect(periodUpdate().some(c => c.params.includes('cmp_a'))).toBe(false);
  });
});
