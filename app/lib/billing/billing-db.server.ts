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
  billingInterval?: 'month' | 'year' | null;
}): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO subscriptions
       (id, user_id, company_id, tier_id, status, current_period_start, current_period_end, stripe_customer_id, stripe_subscription_id, billing_interval)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (company_id) DO UPDATE SET
       tier_id = EXCLUDED.tier_id,
       status = EXCLUDED.status,
       current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
       billing_interval = COALESCE(EXCLUDED.billing_interval, subscriptions.billing_interval),
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
      params.billingInterval ?? null,
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

/**
 * Add one-off, non-expiring tokens to the workspace pool. Idempotent.
 *
 * The customer-facing top-up pack was removed; this now serves only the admin console's manual
 * token grant. The `top_up` source value is kept because historical rows carry it and the
 * `chk_token_balances_source` constraint still admits it.
 */
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

/**
 * Prompts this workspace has spent against the free trial, and whether it is still on the trial.
 *
 * Returned together because the caller (the chat gate) needs both on every request and they live
 * on the same row — a paid workspace is metered in tokens and ignores the count entirely.
 */
export async function getTrialStatusForCompany(
  companyId: string
): Promise<{ tierId: string; promptsUsed: number } | null> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `SELECT tier_id, COALESCE(trial_prompts_used, 0) AS trial_prompts_used
     FROM subscriptions WHERE company_id = $1`,
    [companyId]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return { tierId: row.tier_id as string, promptsUsed: Number(row.trial_prompts_used) };
}

/**
 * Record a paid invoice.
 *
 * The `payments` table has existed since the original schema but nothing ever wrote to it, so the
 * admin console had no payment history to show at all. Keyed on the Stripe invoice id so webhook
 * retries — which Stripe does routinely — cannot produce duplicate rows.
 *
 * Only builds history from now on; invoices paid before this shipped are recoverable only from
 * Stripe itself.
 */
export async function recordPayment(params: {
  userId: string;
  amountCents: number;
  currency: string;
  stripeInvoiceId: string;
  stripeSubscriptionId: string | null;
  tokens: number | null;
}): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO payments
       (id, user_id, type, amount_cents, currency, tokens, stripe_invoice_id, stripe_subscription_id, status)
     VALUES ($1, $2, 'subscription', $3, $4, $5, $6, $7, 'succeeded')
     ON CONFLICT (id) DO NOTHING`,
    [
      `pay_${params.stripeInvoiceId}`,
      params.userId,
      params.amountCents,
      params.currency,
      params.tokens,
      params.stripeInvoiceId,
      params.stripeSubscriptionId,
    ]
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
