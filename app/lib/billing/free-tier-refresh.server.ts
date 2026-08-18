/**
 * Monthly free-tier renewal.
 *
 * Paid plans get a fresh allocation from Stripe's `invoice.paid` webhook once per billing
 * period. The free tier has no Stripe subscription and therefore no invoice, so without this
 * job its one signup grant simply expires and the account is stuck at 402 forever
 * (see api.chat.ts). This is the free tier's equivalent of that webhook.
 *
 * Unused tokens carry over, capped at CARRY_CAP_MONTHS months' worth in total. Without a cap a
 * dormant free account would out-accumulate the paid Builder plan within a year, making it
 * cheaper to wait than to subscribe. Accounts at the ceiling are emailed a warning before and
 * when tokens are forfeited.
 *
 * Projects, chats and snapshots are never touched — this only writes token_balances rows and
 * rolls the subscription period forward.
 */
import { createScopedLogger } from '~/utils/logger';
import { sendTokenCarryOverWarningEmail } from '~/lib/email';
import { FREE_TIER_ID, getPlan } from './plans';
import {
  carryOverUnusedTierBalances,
  grantTierTokens,
  listFreeTierWorkspacesDueForRefresh,
  previewCarryOver,
  recordCarryOverWarning,
  resetCarryOverWarnings,
  setSubscriptionPeriod,
  type FreeTierRefreshCandidate,
} from './billing-db.server';

const logger = createScopedLogger('billing.free-tier-refresh');

/** Batch ceiling per run. Steady state is ~1/30th of free accounts per day, so this is slack. */
const DEFAULT_LIMIT = 2000;

/** Workspaces detailed in a dry-run preview. Enough to eyeball; not a data dump. */
const PREVIEW_SIZE = 20;

/**
 * Total months of allocation a free account may hold at once, including the incoming grant.
 * At 150K/month that is a 450K ceiling: three months idle keeps everything, the fourth forfeits.
 */
export const CARRY_CAP_MONTHS = 3;

/**
 * Consecutive warnings a workspace gets before we go quiet. A dormant free account sits at the
 * ceiling forever, so an unlimited warning would mean a monthly email into a mailbox nobody
 * reads — which earns spam complaints and costs sender reputation. The streak resets if the
 * account drops back under the ceiling, so someone who returns and re-stockpiles is warned again.
 */
export const MAX_CARRYOVER_WARNINGS = 3;

export interface FreeTierRefreshResult {
  mode: 'applied' | 'dry-run';
  /** Workspaces the query found due for renewal. */
  due: number;
  /** Workspaces granted a new period (0 on a dry run). */
  refreshed: number;
  /** Tokens rolled into the new period across the batch. */
  carriedTokens: number;
  /** Tokens withdrawn for exceeding the ceiling. */
  forfeitedTokens: number;
  /** Warning emails sent (0 on a dry run). */
  warned: number;
  /** Workspaces that threw; they stay due and are retried next run. */
  failed: number;
  /** True when the batch limit was hit and more remain for the next run. */
  more: boolean;
  /** Per-workspace detail, dry-run only — what *would* happen. */
  preview?: {
    companyId: string;
    periodStart: string;
    periodEnd: string;
    grant: number;
    carriedOver: number;
    forfeited: number;
    newTotal: number;
  }[];
}

function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);

  return next;
}

/**
 * The period that should be current for a lapsed workspace.
 *
 * Advances from the old period end in whole-month steps until the window contains `now`, so a
 * dormant account that has been away for eight months gets ONE fresh allocation rather than
 * eight stacked ones, while keeping its original renewal day. Matches the naive `setMonth(+1)`
 * used at signup (database-postgresql.ts); month-end dates settle onto a stable day after the
 * first overflow.
 */
export function nextPeriodFor(previousEnd: Date | null, now: Date): { start: Date; end: Date } {
  if (!previousEnd || previousEnd > now) {
    return { start: now, end: addOneMonth(now) };
  }

  let start = previousEnd;
  let end = addOneMonth(start);

  // Guard against a pathological date loop; 1200 months is a century of dormancy.
  for (let i = 0; end <= now && i < 1200; i++) {
    start = end;
    end = addOneMonth(end);
  }

  return { start, end };
}

interface RefreshOneOutcome {
  carriedTokens: number;
  forfeitedTokens: number;
  warned: boolean;
}

async function refreshOne(
  candidate: FreeTierRefreshCandidate,
  monthlyTokens: number,
  budgetTokens: number,
  now: Date
): Promise<RefreshOneOutcome> {
  const { start, end } = nextPeriodFor(candidate.currentPeriodEnd, now);

  /*
   * Carry first, so leftovers and the incoming grant share one expiry. `start` doubles as the
   * previous period end (nextPeriodFor rolls from it), which is what identifies rows that lapsed
   * naturally rather than ones force-expired at cancellation.
   */
  const carry = candidate.currentPeriodEnd
    ? await carryOverUnusedTierBalances(candidate.companyId, candidate.currentPeriodEnd, end, budgetTokens)
    : { carriedRows: 0, carriedTokens: 0, forfeitedRows: 0, forfeitedTokens: 0, atCap: false };

  /*
   * Grant BEFORE rolling the period. If the process dies between the two, the next run still
   * sees the workspace as due and retries — the idempotency key makes the repeat grant a no-op
   * and the carry-over re-applies the same date. Rolling first would mark the account renewed
   * and skip it forever with no tokens.
   */
  await grantTierTokens({
    idempotencyKey: `free_${candidate.companyId}_${start.toISOString().slice(0, 10)}`,
    companyId: candidate.companyId,
    userId: candidate.userId,
    subscriptionId: candidate.subscriptionId,
    tokens: monthlyTokens,
    periodStart: start,
    periodEnd: end,
  });

  await setSubscriptionPeriod(candidate.companyId, start, end);

  /*
   * Warn on the run that fills the budget — a month before anything is actually lost — and on
   * each run that forfeits, up to MAX_CARRYOVER_WARNINGS. Below the ceiling the streak resets,
   * so an account that re-engages and later stockpiles again gets a fresh set of warnings.
   */
  const saturated = carry.atCap || carry.forfeitedTokens > 0;
  let warned = false;

  if (!saturated) {
    await resetCarryOverWarnings(candidate.companyId);
  } else if (candidate.email && candidate.carryoverWarningsSent < MAX_CARRYOVER_WARNINGS) {
    // Email failure must not fail the refresh: the tokens are already granted and correct.
    try {
      warned = await sendTokenCarryOverWarningEmail({
        email: candidate.email,
        carriedTokens: carry.carriedTokens,
        forfeitedTokens: carry.forfeitedTokens,
        capTokens: monthlyTokens * CARRY_CAP_MONTHS,
        nextRenewal: end,
        warningNumber: candidate.carryoverWarningsSent + 1,
        finalWarning: candidate.carryoverWarningsSent + 1 >= MAX_CARRYOVER_WARNINGS,
      });
    } catch (e) {
      logger.error(`Carry-over warning email failed for workspace ${candidate.companyId}`, e);
    }

    // Only count a warning that actually went out, so a bounced send is retried next month.
    if (warned) {
      await recordCarryOverWarning(candidate.companyId);
    }
  }

  return { carriedTokens: carry.carriedTokens, forfeitedTokens: carry.forfeitedTokens, warned };
}

/**
 * Re-grant the free allocation to every free-tier workspace whose period has lapsed.
 *
 * Idempotent on (workspace, period start), so re-running within the same period grants nothing
 * extra. Defaults to a dry run: it mints tokens, so applying is an explicit choice.
 */
export async function refreshFreeTierAllocations(
  options: { dryRun?: boolean; limit?: number } = {}
): Promise<FreeTierRefreshResult> {
  const dryRun = options.dryRun !== false;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const plan = getPlan(FREE_TIER_ID);

  if (!plan) {
    throw new Error(`Free tier ${FREE_TIER_ID} is missing from the plan catalog`);
  }

  // The incoming grant occupies one month of the ceiling; the rest is what may roll over.
  const budgetTokens = plan.tokens * (CARRY_CAP_MONTHS - 1);

  const now = new Date();
  const candidates = await listFreeTierWorkspacesDueForRefresh(limit);
  const more = candidates.length === limit;

  if (dryRun) {
    const preview = [];

    for (const candidate of candidates.slice(0, PREVIEW_SIZE)) {
      const { start, end } = nextPeriodFor(candidate.currentPeriodEnd, now);
      const carry = candidate.currentPeriodEnd
        ? await previewCarryOver(candidate.companyId, candidate.currentPeriodEnd, budgetTokens)
        : { carriedTokens: 0, forfeitedTokens: 0 };

      preview.push({
        companyId: candidate.companyId,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        grant: plan.tokens,
        carriedOver: carry.carriedTokens,
        forfeited: carry.forfeitedTokens,
        newTotal: plan.tokens + carry.carriedTokens,
      });
    }

    return {
      mode: 'dry-run',
      due: candidates.length,
      refreshed: 0,
      carriedTokens: preview.reduce((sum, p) => sum + p.carriedOver, 0),
      forfeitedTokens: preview.reduce((sum, p) => sum + p.forfeited, 0),
      warned: 0,
      failed: 0,
      more,
      preview,
    };
  }

  let refreshed = 0;
  let carriedTokens = 0;
  let forfeitedTokens = 0;
  let warned = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const outcome = await refreshOne(candidate, plan.tokens, budgetTokens, now);
      carriedTokens += outcome.carriedTokens;
      forfeitedTokens += outcome.forfeitedTokens;
      warned += outcome.warned ? 1 : 0;
      refreshed++;
    } catch (e) {
      // One bad workspace must not abort the batch; it stays due and is retried next run.
      failed++;
      logger.error(`Free-tier refresh failed for workspace ${candidate.companyId}`, e);
    }
  }

  logger.info(
    `Free-tier refresh: due=${candidates.length} refreshed=${refreshed} carried=${carriedTokens} ` +
      `forfeited=${forfeitedTokens} warned=${warned} failed=${failed}`
  );

  return { mode: 'applied', due: candidates.length, refreshed, carriedTokens, forfeitedTokens, warned, failed, more };
}
