import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Inactivity win-back mail.
 *
 * The properties that matter (each is a way real customers get mailed wrongly if it breaks):
 *  - Dry run sends nothing and writes nothing.
 *  - Every candidate is mailed once and logged once, numbered by how many they've already had.
 *  - The last permitted nudge is flagged final, so the copy can say the reminders stop.
 *  - A refused send is logged as undelivered, so it does NOT burn one of the two chances.
 *  - One address that throws cannot abort the batch.
 *  - `more` reports a saturated batch, so the operator knows a backlog remains.
 */

const state = vi.hoisted(() => ({
  calls: [] as { sql: string; params: any[] }[],
  /** Rows the candidate query returns: shape mirrors the real SELECT. */
  candidates: [] as any[],
}));

const sendNudge = vi.hoisted(() => vi.fn(async () => true));

vi.mock('~/lib/email', () => ({ sendInactivityEmail: sendNudge }));

vi.mock('~/lib/database-postgresql', () => ({
  getPostgresPool: () => ({
    async query(sql: string, params: any[] = []) {
      state.calls.push({ sql, params });

      if (/FROM users/i.test(sql)) {
        return { rows: state.candidates, rowCount: state.candidates.length };
      }

      return { rows: [], rowCount: 0 };
    },
  }),
}));

const { sendInactivityNudges, MAX_INACTIVITY_NUDGES } = await import('./inactivity.server');

/** A candidate last seen `days` ago, having already received `nudgesSent` reminders. */
function candidate(id: string, days: number, nudgesSent = 0) {
  return {
    id,
    email: `${id}@example.com`,
    last_seen: new Date(Date.now() - days * 86_400_000).toISOString(),
    nudges_sent: String(nudgesSent),
  };
}

/** The email_logs writes only. */
function inserts() {
  return state.calls.filter(c => /INSERT INTO email_logs/i.test(c.sql));
}

beforeEach(() => {
  state.calls = [];
  state.candidates = [];
  sendNudge.mockReset();
  sendNudge.mockResolvedValue(true);
});

describe('sendInactivityNudges', () => {
  describe('dry run', () => {
    it('is the default, and neither mails nor writes', async () => {
      state.candidates = [candidate('a', 31), candidate('b', 40)];

      const result = await sendInactivityNudges();

      expect(result.mode).toBe('dry-run');
      expect(result.due).toBe(2);
      expect(result.sent).toBe(0);
      expect(sendNudge).not.toHaveBeenCalled();
      expect(inserts()).toHaveLength(0);
    });

    it('previews who would be mailed, and which reminder it would be', async () => {
      state.candidates = [candidate('a', 31, 0), candidate('b', 65, 1)];

      const result = await sendInactivityNudges();

      expect(result.preview).toEqual([
        { email: 'a@example.com', daysInactive: 31, nudgeNumber: 1 },
        { email: 'b@example.com', daysInactive: 65, nudgeNumber: 2 },
      ]);
    });
  });

  describe('applied run', () => {
    it('mails each candidate once and logs the send', async () => {
      state.candidates = [candidate('a', 31), candidate('b', 45)];

      const result = await sendInactivityNudges({ dryRun: false });

      expect(result.mode).toBe('applied');
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(sendNudge).toHaveBeenCalledTimes(2);
      expect(inserts()).toHaveLength(2);
    });

    it('reports the days idle it measured, so the copy is not vague', async () => {
      state.candidates = [candidate('a', 37)];

      await sendInactivityNudges({ dryRun: false });

      expect(sendNudge).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@example.com', daysInactive: 37 }));
    });

    it('numbers the log row by the reminder it is, so a duplicate is visible', async () => {
      state.candidates = [candidate('a', 65, 1)];

      await sendInactivityNudges({ dryRun: false });

      expect(inserts()[0].params).toContain(`inactivity_${MAX_INACTIVITY_NUDGES}`);
    });

    it('flags only the last permitted nudge as final', async () => {
      state.candidates = [candidate('a', 31, 0)];
      await sendInactivityNudges({ dryRun: false });
      expect(sendNudge).toHaveBeenCalledWith(expect.objectContaining({ finalNudge: false }));

      sendNudge.mockClear();
      state.candidates = [candidate('b', 65, MAX_INACTIVITY_NUDGES - 1)];
      await sendInactivityNudges({ dryRun: false });
      expect(sendNudge).toHaveBeenCalledWith(expect.objectContaining({ finalNudge: true }));
    });

    it('reports a saturated batch as having more to do', async () => {
      state.candidates = [candidate('a', 31), candidate('b', 32)];

      const result = await sendInactivityNudges({ dryRun: false, limit: 2 });

      expect(result.more).toBe(true);
    });
  });

  describe('failures', () => {
    it('logs a refused send as undelivered, so it is retried rather than counted', async () => {
      state.candidates = [candidate('a', 31)];
      sendNudge.mockResolvedValueOnce(false);

      const result = await sendInactivityNudges({ dryRun: false });

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);

      // delivered=false is what makes the candidate query pick this account up again.
      expect(inserts()[0].params).toContain(false);
    });

    it('keeps going when one address throws', async () => {
      state.candidates = [candidate('a', 31), candidate('b', 32)];
      sendNudge.mockRejectedValueOnce(new Error('resend down'));

      const result = await sendInactivityNudges({ dryRun: false });

      expect(result.failed).toBe(1);
      expect(result.sent).toBe(1);
      expect(sendNudge).toHaveBeenCalledTimes(2);
    });
  });
});
