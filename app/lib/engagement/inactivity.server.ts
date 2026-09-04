/**
 * Inactivity win-back emails.
 *
 * Nudges accounts that have stopped signing in, then goes quiet. There is no in-app equivalent:
 * a banner can only reach someone who opens the app, and the entire population this targets is
 * the one that doesn't.
 *
 * Nothing here writes to the account — no tokens, no tier changes, no deletion. The only side
 * effects are an email and the `email_logs` row that records it.
 *
 * PostgreSQL only. Reuses the main connection pool.
 */
import crypto from 'crypto';
import { getPostgresPool } from '~/lib/database-postgresql';
import { sendInactivityEmail } from '~/lib/email';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('engagement.inactivity');

/** Batch ceiling per run. The backlog only ever grows by a day's worth, so this is slack. */
const DEFAULT_LIMIT = 1000;

/** Accounts detailed in a dry-run preview. Enough to eyeball; not a data dump. */
const PREVIEW_SIZE = 20;

/**
 * Days idle before the first nudge. The second lands one full interval later (60 days), because
 * the threshold scales with the number already sent.
 */
export const INACTIVITY_DAYS = 30;

/**
 * Consecutive nudges an account gets before we stop. A dead mailbox stays inactive forever, so an
 * uncapped reminder is a permanent monthly send into an address nobody reads — which earns spam
 * complaints and costs sender reputation. Signing in resets the clock, so someone who returns and
 * lapses again is nudged afresh.
 */
export const MAX_INACTIVITY_NUDGES = 2;

export interface InactivityCandidate {
  userId: string;
  email: string;
  lastSeen: Date;
  daysInactive: number;
  nudgesSent: number;
}

export interface InactivityResult {
  mode: 'applied' | 'dry-run';
  /** Accounts the query found due for a nudge. */
  due: number;
  /** Nudges actually sent (0 on a dry run). */
  sent: number;
  /** Accounts that threw; they stay due and are retried next run. */
  failed: number;
  /** True when the batch limit was hit and more remain for the next run. */
  more: boolean;
  /** Per-account detail, dry-run only — who *would* be mailed. */
  preview?: { email: string; daysInactive: number; nudgeNumber: number }[];
}

/**
 * Accounts overdue for a nudge.
 *
 * `last_login` is the activity signal; it falls back to `created_at` for someone who registered,
 * verified, and never came back — that account is inactive from day one and would otherwise be
 * invisible to this query.
 *
 * Only verified addresses are considered. Unverified signups are where the typos and disposable
 * addresses collect, and mailing them is how a young sending domain acquires a bounce rate.
 *
 * The threshold scales with nudges already delivered, so the second reminder waits a further
 * INACTIVITY_DAYS rather than following the first on the next nightly run. Only `delivered` rows
 * count, so a send that failed is retried instead of consuming one of the two chances.
 */
export async function listInactiveUsers(limit: number): Promise<InactivityCandidate[]> {
  const pool = getPostgresPool();

  const result = await pool.query(
    `SELECT u.id,
            u.email,
            COALESCE(u.last_login, u.created_at) AS last_seen,
            COUNT(e.id) FILTER (WHERE e.delivered) AS nudges_sent
     FROM users u
     LEFT JOIN email_logs e
       ON e.user_id = u.id
      AND e.email_type LIKE 'inactivity_%'
     WHERE u.is_verified = TRUE
       AND u.email IS NOT NULL
     GROUP BY u.id
     HAVING COUNT(e.id) FILTER (WHERE e.delivered) < $1
        AND COALESCE(u.last_login, u.created_at)
            < NOW() - (($2::int * (COUNT(e.id) FILTER (WHERE e.delivered) + 1))::text || ' days')::interval
     ORDER BY last_seen ASC
     LIMIT $3`,
    [MAX_INACTIVITY_NUDGES, INACTIVITY_DAYS, limit]
  );

  const now = Date.now();

  return result.rows.map((row: any) => {
    const lastSeen = new Date(row.last_seen);

    return {
      userId: row.id,
      email: row.email,
      lastSeen,
      daysInactive: Math.floor((now - lastSeen.getTime()) / 86_400_000),
      nudgesSent: Number(row.nudges_sent),
    };
  });
}

/**
 * Record the nudge. The `email_logs` row is what stops the next run re-sending, so a delivered
 * email that failed to log would be sent again tomorrow — hence the numbered type, which makes a
 * duplicate visible in the table rather than silently indistinguishable.
 */
async function recordNudge(userId: string, nudgeNumber: number, delivered: boolean, error?: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO email_logs (id, user_id, email_type, delivered, error_message)
     VALUES ($1, $2, $3, $4, $5)`,
    [crypto.randomUUID(), userId, `inactivity_${nudgeNumber}`, delivered, error ?? null]
  );
}

/**
 * Email every account that has gone quiet for long enough.
 *
 * Defaults to a dry run: it mails real people, so sending is an explicit choice.
 */
export async function sendInactivityNudges(
  options: { dryRun?: boolean; limit?: number } = {}
): Promise<InactivityResult> {
  const dryRun = options.dryRun !== false;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const candidates = await listInactiveUsers(limit);
  const more = candidates.length === limit;

  if (dryRun) {
    return {
      mode: 'dry-run',
      due: candidates.length,
      sent: 0,
      failed: 0,
      more,
      preview: candidates.slice(0, PREVIEW_SIZE).map(c => ({
        email: c.email,
        daysInactive: c.daysInactive,
        nudgeNumber: c.nudgesSent + 1,
      })),
    };
  }

  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const nudgeNumber = candidate.nudgesSent + 1;

    try {
      const delivered = await sendInactivityEmail({
        email: candidate.email,
        daysInactive: candidate.daysInactive,
        finalNudge: nudgeNumber >= MAX_INACTIVITY_NUDGES,
      });

      await recordNudge(candidate.userId, nudgeNumber, delivered, delivered ? undefined : 'Send failed');

      if (delivered) {
        sent++;
      } else {
        failed++;
      }
    } catch (e) {
      // One bad address must not abort the batch; it stays due and is retried next run.
      failed++;
      logger.error(`Inactivity nudge failed for user ${candidate.userId}`, e);
    }
  }

  logger.info(`Inactivity nudges: due=${candidates.length} sent=${sent} failed=${failed} more=${more}`);

  return { mode: 'applied', due: candidates.length, sent, failed, more };
}
