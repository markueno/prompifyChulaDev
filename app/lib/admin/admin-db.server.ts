/**
 * Data layer for the platform admin console (/app/admin).
 *
 * Scope note: everything here is deliberately read-mostly and workspace-aware. Token and tier
 * state lives on the *workspace* (a personal account's workspace is `personalCompanyId(userId)`),
 * not on the user row, so the write helpers delegate to the existing billing helpers rather than
 * touching token_balances/subscriptions directly.
 */
import { getPostgresPool, personalCompanyId } from '~/lib/database-postgresql';
import {
  addTopUpTokens,
  upsertSubscription,
  expireActiveTierBalances,
  grantTierTokens,
} from '~/lib/billing/billing-db.server';
import { getPlan, FREE_TIER_ID } from '~/lib/billing/plans';

export interface AdminUserRow {
  id: string;
  email: string;
  isVerified: boolean;
  isModerator: boolean;
  isSuperadmin: boolean;
  /** false = suspended (the account cannot spend tokens). */
  tokenApproved: boolean;
  createdAt: string | null;
  lastLogin: string | null;
  tierId: string | null;
  tierName: string | null;
  subscriptionStatus: string | null;
  /** Set when the subscription is managed by Stripe — a manual tier change is refused then. */
  stripeSubscriptionId: string | null;
  tokensAllocated: number;
  tokensUsed: number;
  tokensRemaining: number;
  chatCount: number;
  projectCount: number;
}

export interface AdminUserPage {
  users: AdminUserRow[];
  total: number;
}

/**
 * One page of users with their billing and usage state.
 *
 * Aggregates are computed in scalar sub-selects rather than joins on purpose: token_balances and
 * chats are both one-to-many against users, so joining them together would multiply rows and
 * inflate every total.
 */
export async function listUsersForAdmin(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminUserPage> {
  const pool = getPostgresPool();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const search = opts.search?.trim();

  const where = search ? `WHERE u.deleted_at IS NULL AND u.email ILIKE $3` : `WHERE u.deleted_at IS NULL`;
  const params: unknown[] = search ? [limit, offset, `%${search}%`] : [limit, offset];

  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT
         u.id, u.email, u.is_verified, u.is_moderator, u.is_superadmin, u.token_approved,
         u.created_at, u.last_login,
         s.tier_id, s.status AS subscription_status, s.stripe_subscription_id,
         t.display_name AS tier_name,
         COALESCE((SELECT SUM(b.tokens_allocated) FROM token_balances b WHERE b.user_id = u.id), 0)::bigint AS tokens_allocated,
         COALESCE((SELECT SUM(b.tokens_used)      FROM token_balances b WHERE b.user_id = u.id), 0)::bigint AS tokens_used,
         COALESCE((SELECT COUNT(*) FROM chats c    WHERE c.user_id = u.id), 0)::int AS chat_count,
         COALESCE((SELECT COUNT(*) FROM projects p WHERE p.owner_user_id = u.id), 0)::int AS project_count
       FROM users u
       -- Mirrors personalCompanyId() in database-postgresql.ts; keep the prefix in step with it.
       LEFT JOIN subscriptions s ON s.company_id = 'cmp_personal_' || u.id
       LEFT JOIN subscription_tiers t ON t.id = s.tier_id
       ${where}
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      params
    );

    const countResult = await client.query(
      search
        ? `SELECT COUNT(*)::int AS n FROM users u WHERE u.deleted_at IS NULL AND u.email ILIKE $1`
        : `SELECT COUNT(*)::int AS n FROM users u`,
      search ? [`%${search}%`] : []
    );

    const users: AdminUserRow[] = rows.map((r: Record<string, any>) => {
      const allocated = Number(r.tokens_allocated ?? 0);
      const used = Number(r.tokens_used ?? 0);

      return {
        id: r.id,
        email: r.email,
        isVerified: Boolean(r.is_verified),
        isModerator: Boolean(r.is_moderator),
        isSuperadmin: Boolean(r.is_superadmin),
        tokenApproved: Boolean(r.token_approved),
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        lastLogin: r.last_login ? new Date(r.last_login).toISOString() : null,
        tierId: r.tier_id ?? null,
        tierName: r.tier_name ?? null,
        subscriptionStatus: r.subscription_status ?? null,
        stripeSubscriptionId: r.stripe_subscription_id ?? null,
        tokensAllocated: allocated,
        tokensUsed: used,
        tokensRemaining: Math.max(allocated - used, 0),
        chatCount: Number(r.chat_count ?? 0),
        projectCount: Number(r.project_count ?? 0),
      };
    });

    return { users, total: countResult.rows[0]?.n ?? users.length };
  } finally {
    client.release();
  }
}

/**
 * Look one account up by id. Used to verify a delete confirmation — reusing the search-based
 * listing for that is wrong, because an ILIKE match can return a different account whose email
 * merely contains the typed one.
 */
export async function getAdminUserEmail(userId: string): Promise<string | null> {
  const pool = getPostgresPool();
  const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [userId]);

  return rows[0]?.email ?? null;
}

/** Comp tokens to a user's personal workspace. Non-expiring, same mechanism as a paid top-up. */
export async function adminGrantTokens(userId: string, tokens: number, actorId: string): Promise<void> {
  await addTopUpTokens({
    // Unique per grant so two comps of the same size both land (the helper is idempotent on this).
    idempotencyKey: `admin_${actorId}_${userId}_${Date.now()}`,
    companyId: personalCompanyId(userId),
    userId,
    tokens,
  });
}

/**
 * Move a user between tiers without going through Stripe, and grant that tier's allocation.
 *
 * Refuses when Stripe owns the subscription: the next invoice.paid / subscription.updated webhook
 * would overwrite the manual change, leaving the app and Stripe quietly disagreeing about what
 * the customer is paying for. Those cases have to be changed in Stripe itself.
 */
export async function adminChangeTier(
  userId: string,
  tierId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const plan = getPlan(tierId);

  if (!plan) {
    return { ok: false, reason: `Unknown tier "${tierId}"` };
  }

  const companyId = personalCompanyId(userId);
  const pool = getPostgresPool();

  const { rows } = await pool.query(`SELECT stripe_subscription_id FROM subscriptions WHERE company_id = $1 LIMIT 1`, [
    companyId,
  ]);

  if (rows[0]?.stripe_subscription_id) {
    return {
      ok: false,
      reason: 'This account has an active Stripe subscription — change the plan in Stripe so the two stay in sync.',
    };
  }

  // Replace the tier allocation: retire the old one first so balances don't stack up.
  await expireActiveTierBalances(companyId);
  await upsertSubscription({
    companyId,
    userId,
    tierId,
    status: 'active',
    periodStart: new Date(),
    periodEnd: null,
  });

  if (plan.tokens > 0 && tierId !== FREE_TIER_ID) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await grantTierTokens({
      idempotencyKey: `admin_tier_${userId}_${Date.now()}`,
      companyId,
      userId,
      subscriptionId: `manual_${tierId}`,
      tokens: plan.tokens,
      periodStart: now,
      periodEnd,
    });
  }

  return { ok: true };
}

/** Soft suspend / restore. token_approved=false stops the account spending tokens. */
export async function adminSetSuspended(userId: string, suspended: boolean): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(`UPDATE users SET token_approved = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
    userId,
    !suspended,
  ]);
}

/**
 * Soft-delete an account.
 *
 * Deliberately NOT `DELETE FROM users`: every user-referencing table is ON DELETE CASCADE, so a
 * hard delete destroyed the person's chats, projects, token history and billing records along with
 * the row. Nothing about an account deletion should discard the business's own records.
 *
 * The row keeps its email, so the address stays locked and cannot be re-registered. Sessions are
 * removed rather than flagged — they are ephemeral credentials, not history, and dropping them
 * signs the account out everywhere immediately instead of at token expiry.
 */
export async function adminDeleteUser(userId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE users
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
}

/** Guard: an admin must not be able to delete or suspend their own account by accident. */
export function isSelf(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}
