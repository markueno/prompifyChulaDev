/**
 * What a user's plan lets them do with workspaces.
 *
 * Lives apart from the role predicates in workspace-roles.ts: those answer "what may this member
 * do inside a workspace", this answers "may this account have one at all". Server-only — it
 * reads subscriptions.
 */
import { countOwnedWorkspaces, getTierIdsForOwner } from '~/lib/database';
import { getPlan } from '~/lib/billing/plans';

export interface WorkspaceAllowance {
  /** Workspaces the plan permits, beyond the personal one. Zero means creation is not available. */
  max: number;
  owned: number;
  canCreate: boolean;
}

export async function getWorkspaceAllowance(userId: string): Promise<WorkspaceAllowance> {
  const [tierIds, owned] = await Promise.all([getTierIdsForOwner(userId), countOwnedWorkspaces(userId)]);

  /*
   * The best of their tiers, not the sum. Subscriptions are per-workspace today, so someone who
   * bought Business twice has two rows — that buys them more seats in each, not more workspaces.
   */
  const max = tierIds.reduce((best, tierId) => Math.max(best, getPlan(tierId)?.maxWorkspaces ?? 0), 0);

  return { max, owned, canCreate: owned < max };
}
