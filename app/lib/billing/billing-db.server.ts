/**
 * Billing persistence (workspace-scoped, B2B Phase 1).
 *
 * Subscriptions and the token pool belong to a WORKSPACE (`companies` row), not an
 * individual. A personal account is a workspace of 1. `user_id` is still stored on
 * rows (NOT NULL) and set to the buyer/owner for attribution.
 *
 * PostgreSQL only. Reuses the main connection pool.
 */
import crypto from 'crypto';
import { getPostgresPool } from '~/lib/database-postgresql';
import { FREE_TIER_ID } from './plans';

/** Stripe customer id stored for a workspace, or null. */
export async function getStripeCustomerIdForCompany(companyId: string): Promise<string | null> {
  const pool = getPostgresPool();
  const result = await pool.query(`SELECT stripe_customer_id FROM subscriptions WHERE company_id = $1`, [companyId]);

  return result.rows[0]?.stripe_customer_id ?? null;
}

/** Workspace that owns a Stripe customer id (webhook reverse lookup). */
export async function getCompanyIdByStripeCustomerId(customerId: string): Promise<string | null> {
  const pool = getPostgresPool();
  const result = await pool.query(`SELECT company_id FROM subscriptions WHERE stripe_customer_id = $1`, [customerId]);

  return result.rows[0]?.company_id ?? null;
}

/** Owner user id of a workspace (satisfies NOT NULL user_id on balances/subscriptions). */
export async function getCompanyOwnerUserId(companyId: string): Promise<string | null> {
  const pool = getPostgresPool();
  const result = await pool.query(`SELECT owner_user_id FROM companies WHERE id = $1`, [companyId]);

  return result.rows[0]?.owner_user_id ?? null;
}

/** Ensure a subscription row exists for the workspace and store the Stripe customer id. */
export async function setStripeCustomerIdForCompany(
  companyId: string,
  userId: string,
  customerId: string
): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO subscriptions (id, user_id, company_id, tier_id, status, stripe_customer_id)
     VALUES ($1, $2, $3, 'tier_trial', 'active', $4)
     ON CONFLICT (company_id)
     DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = CURRENT_TIMESTAMP`,
    [crypto.randomUUID(), userId, companyId, customerId]
  );
}

/** Upsert the workspace's subscription tier/status/period after a Stripe event. */
export async function upsertSubscription(params: {
  companyId: string;
  userId: string;
  tierId: string;
  status: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO subscriptions
       (id, user_id, company_id, tier_id, status, current_period_start, current_period_end, stripe_customer_id, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (company_id) DO UPDATE SET
       tier_id = EXCLUDED.tier_id,
       status = EXCLUDED.status,
       current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      crypto.randomUUID(),
      params.userId,
      params.companyId,
      params.tierId,
      params.status,
      params.periodStart?.toISOString() ?? null,
      params.periodEnd?.toISOString() ?? null,
      params.stripeCustomerId ?? null,
      params.stripeSubscriptionId ?? null,
    ]
  );
}

/** Set a workspace's seat cap (from the purchased plan). */
export async function setCompanySeats(companyId: string, seats: number): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(`UPDATE companies SET seats = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [companyId, seats]);
}

/**
 * Grant a plan's monthly token allocation to the workspace pool for one period.
 * Idempotent on the Stripe invoice id, so retries never double-credit.
 */
export async function grantTierTokens(params: {
  idempotencyKey: string;
  companyId: string;
  userId: string;
  subscriptionId: string;
  tokens: number;
  periodStart: Date;
  periodEnd: Date;
}): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO token_balances
       (id, user_id, company_id, source, source_reference_id, tokens_allocated, tokens_used, effective_start, effective_end)
     VALUES ($1, $2, $3, 'tier', $4, $5, 0, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      `bal_${params.idempotencyKey}`,
      params.userId,
      params.companyId,
      params.subscriptionId,
      params.tokens,
      params.periodStart.toISOString(),
      params.periodEnd.toISOString(),
    ]
  );
}

/** Add one-off, non-expiring top-up tokens to the workspace pool. Idempotent. */
export async function addTopUpTokens(params: {
  idempotencyKey: string;
  companyId: string;
  userId: string;
  tokens: number;
}): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO token_balances
       (id, user_id, company_id, source, source_reference_id, tokens_allocated, tokens_used, effective_start, effective_end)
     VALUES ($1, $2, $3, 'top_up', $4, $5, 0, CURRENT_TIMESTAMP, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [`bal_${params.idempotencyKey}`, params.userId, params.companyId, params.idempotencyKey, params.tokens]
  );
}

export interface FreeTierRefreshCandidate {
  companyId: string;
  userId: string;
  subscriptionId: string;
  currentPeriodEnd: Date | null;
  /** Owner's address, for the carry-over expiry warning. Null if the user row is gone. */
  email: string | null;
  /** Consecutive carry-over warnings already sent, so we stop nagging a dormant account. */
  carryoverWarningsSent: number;
}

/**
 * Free-tier workspaces whose allocation period has lapsed and are due a fresh grant.
 *
 * Selection is on `tier_id` alone, NOT on `stripe_subscription_id IS NULL`. A workspace that
 * churned off a paid plan keeps its old `stripe_subscription_id` (upsertSubscription COALESCEs
 * it rather than clearing it), so filtering on that column would permanently starve former
 * customers — the population most likely to come back. `tier_id` is the authority on what a
 * workspace is entitled to right now; a live paid subscriber never sits on FREE_TIER_ID.
 */
export async function listFreeTierWorkspacesDueForRefresh(limit: number): Promise<FreeTierRefreshCandidate[]> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `SELECT s.company_id, s.user_id, s.id AS subscription_id, s.current_period_end,
            s.carryover_warnings_sent, u.email
     FROM subscriptions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.tier_id = $1
       AND (s.current_period_end IS NULL OR s.current_period_end <= CURRENT_TIMESTAMP)
     ORDER BY s.current_period_end ASC NULLS FIRST
     LIMIT $2`,
    [FREE_TIER_ID, limit]
  );

  return result.rows.map(row => ({
    companyId: row.company_id as string,
    userId: row.user_id as string,
    subscriptionId: row.subscription_id as string,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    email: (row.email as string) ?? null,
    carryoverWarningsSent: Number(row.carryover_warnings_sent ?? 0),
  }));
}

/** Count a carry-over warning as delivered, so the next run knows how many have gone out. */
export async function recordCarryOverWarning(companyId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE subscriptions
        SET carryover_warnings_sent = carryover_warnings_sent + 1, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = $1`,
    [companyId]
  );
}

/** Clear the warning streak once a workspace is back under the ceiling (it re-engaged). */
export async function resetCarryOverWarnings(companyId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE subscriptions
        SET carryover_warnings_sent = 0, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = $1 AND carryover_warnings_sent <> 0`,
    [companyId]
  );
}

export interface CarryOverResult {
  carriedRows: number;
  carriedTokens: number;
  forfeitedRows: number;
  forfeitedTokens: number;
  /** True when the carry budget is exhausted, i.e. next period will forfeit unless they spend. */
  atCap: boolean;
}

/**
 * The rows eligible to roll into the next period: the grant that lapsed with the previous period,
 * plus anything already carried (carrying sets them all to that same `effective_end`).
 *
 * Matching on the exact previous period end is what keeps cancellation honest. A workspace that
 * churned off a paid plan has leftover paid-tier rows force-expired by `expireActiveTierBalances`
 * at the moment of cancellation — a different timestamp — so they are never picked up here. A
 * looser "any expired tier row" filter would hand a churned customer their unused 1M paid tokens
 * back on the free plan.
 */
async function selectCarryCandidates(companyId: string, previousPeriodEnd: Date) {
  const pool = getPostgresPool();
  const result = await pool.query(
    `SELECT id, (tokens_allocated - tokens_used) AS unused
       FROM token_balances
      WHERE company_id = $1
        AND source = 'tier'
        AND tokens_allocated > tokens_used
        AND effective_end = $2
      ORDER BY created_at DESC`,
    [companyId, previousPeriodEnd.toISOString()]
  );

  return result.rows.map(r => ({ id: r.id as string, unused: Number(r.unused) }));
}

/**
 * Carry unused tier tokens into the new period, up to `budgetTokens`; forfeit the excess.
 *
 * Carrying pushes `effective_end` out rather than folding amounts into the next grant. Moving a
 * date is naturally idempotent — a re-run in the same period writes the same value and changes
 * nothing. Folding amounts would re-carry the same leftover every month unless the old row's
 * `tokens_used` were also inflated, which would make usage reporting lie.
 *
 * Forfeiting writes `tokens_allocated = tokens_used`, withdrawing the unspent allocation rather
 * than inflating usage. That keeps the admin dashboard's `tokens_used` sums truthful, and makes
 * the forfeit durable: the row no longer satisfies `tokens_allocated > tokens_used`, so it can
 * never be picked up by a later run.
 *
 * Newest rows are kept first, so what survives is the tokens granted most recently.
 */
export async function carryOverUnusedTierBalances(
  companyId: string,
  previousPeriodEnd: Date,
  newPeriodEnd: Date,
  budgetTokens: number
): Promise<CarryOverResult> {
  const pool = getPostgresPool();
  const candidates = await selectCarryCandidates(companyId, previousPeriodEnd);

  const keep: string[] = [];
  const forfeit: string[] = [];
  let carriedTokens = 0;
  let forfeitedTokens = 0;

  for (const row of candidates) {
    /*
     * Let the row that straddles the budget through rather than splitting it; at most one row,
     * and erring toward the customer on a free plan is the cheaper mistake.
     */
    if (carriedTokens < budgetTokens) {
      keep.push(row.id);
      carriedTokens += row.unused;
    } else {
      forfeit.push(row.id);
      forfeitedTokens += row.unused;
    }
  }

  if (keep.length > 0) {
    await pool.query(
      `UPDATE token_balances SET effective_end = $2, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::text[])`,
      [keep, newPeriodEnd.toISOString()]
    );
  }

  if (forfeit.length > 0) {
    await pool.query(
      `UPDATE token_balances
          SET tokens_allocated = tokens_used, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])`,
      [forfeit]
    );
  }

  return {
    carriedRows: keep.length,
    carriedTokens,
    forfeitedRows: forfeit.length,
    forfeitedTokens,
    atCap: carriedTokens >= budgetTokens,
  };
}

/** What a workspace would carry and forfeit at its next refresh, without writing (dry runs). */
export async function previewCarryOver(
  companyId: string,
  previousPeriodEnd: Date,
  budgetTokens: number
): Promise<{ carriedTokens: number; forfeitedTokens: number }> {
  const candidates = await selectCarryCandidates(companyId, previousPeriodEnd);

  let carriedTokens = 0;
  let forfeitedTokens = 0;

  for (const row of candidates) {
    if (carriedTokens < budgetTokens) {
      carriedTokens += row.unused;
    } else {
      forfeitedTokens += row.unused;
    }
  }

  return { carriedTokens, forfeitedTokens };
}

/** Roll a workspace's allocation period forward (free-tier renewal; Stripe owns paid periods). */
export async function setSubscriptionPeriod(companyId: string, start: Date, end: Date): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE subscriptions
       SET current_period_start = $2, current_period_end = $3, updated_at = CURRENT_TIMESTAMP
     WHERE company_id = $1`,
    [companyId, start.toISOString(), end.toISOString()]
  );
}

/** Expire a workspace's still-active tier balances (on cancellation). Top-ups are kept. */
export async function expireActiveTierBalances(companyId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE token_balances
       SET effective_end = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE company_id = $1
       AND source = 'tier'
       AND (effective_end IS NULL OR effective_end > CURRENT_TIMESTAMP)`,
    [companyId]
  );
}
