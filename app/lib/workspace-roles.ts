/**
 * Workspace roles and what each one is allowed to do.
 *
 * Distinct from the platform admin console, which is gated by the `isSuperadmin` JWT claim via
 * requireSuperadmin() and lets the Prompify team act on every account. Nothing here grants any of
 * that.
 *
 * The split between the three working roles is what each has authority over: an editor over the
 * work, an admin over the workspace, an owner over the money.
 *
 *   owner   billed, invites, removes anyone, builds       — exactly one per workspace
 *   admin   invites, removes anyone but the owner, builds — not billed
 *   editor  builds                                        — no authority over people
 *   viewer  reads                                         — free, consumes no seat
 *
 * Safe to import on the client: no secrets, no database access.
 */

export type CompanyRole = 'owner' | 'admin' | 'editor' | 'viewer';

/**
 * The single owner. Billing, plan changes and deleting the workspace.
 *
 * Note this no longer accepts the string 'admin'. It did during the admin→owner rename, when that
 * value meant what 'owner' means now; it is a distinct and lesser role from here on, and accepting
 * it would hand every admin the owner's powers.
 */
export function isWorkspaceOwner(role: string | null | undefined): boolean {
  return role === 'owner';
}

/** Invite, remove and re-role members. Admins may not touch the owner. */
export function canManageMembers(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Create projects, prompt, edit and deploy.
 *
 * `developer` is accepted while rows written before the developer→editor migration remain, so the
 * code and the data migration need not land together. Remove once none are left.
 */
export function canBuildInWorkspace(role: string | null | undefined): boolean {
  return canManageMembers(role) || role === 'editor' || role === 'developer';
}

/**
 * Whether this member counts against the plan's seat allowance.
 *
 * Deliberately the same set as canBuildInWorkspace: you pay for people who can build, and viewing
 * is free. Keeping it one predicate rather than two lists stops the seat check and the permission
 * check drifting apart as roles change.
 */
export function consumesSeat(role: string | null | undefined): boolean {
  return canBuildInWorkspace(role);
}

/** Roles an invitation or a role change may grant. Never `owner` — that is a transfer, not a grant. */
export const ASSIGNABLE_ROLES: CompanyRole[] = ['admin', 'editor', 'viewer'];

export function isAssignableRole(role: string | null | undefined): role is CompanyRole {
  return ASSIGNABLE_ROLES.includes(role as CompanyRole);
}
