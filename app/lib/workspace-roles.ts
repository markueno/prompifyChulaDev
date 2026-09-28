/**
 * Workspace roles and what each one is allowed to do.
 *
 * Distinct from the platform admin console, which is gated by the `isSuperadmin` JWT claim via
 * requireSuperadmin() and lets the Prompify team act on every account. Nothing here grants any of
 * that. The two were both called "admin", which made the distinction impossible to state out loud,
 * so the workspace role is now `owner`.
 *
 * Safe to import on the client: no secrets, no database access.
 */

export type CompanyRole = 'owner' | 'developer' | 'viewer';

/**
 * Rows written before the rename say 'admin'.
 *
 * Accepted here rather than only in the migration so that deploying the code and migrating the
 * data don't have to be simultaneous — otherwise every existing workspace owner loses their
 * permissions in the window between the two. Remove once no `role = 'admin'` rows remain.
 */
const LEGACY_OWNER_ROLE = 'admin';

/** Can manage members, invites and workspace settings. */
export function isWorkspaceOwner(role: string | null | undefined): boolean {
  return role === 'owner' || role === LEGACY_OWNER_ROLE;
}

/** Can create and act on apps. Viewers are read-only. */
export function canBuildInWorkspace(role: string | null | undefined): boolean {
  return isWorkspaceOwner(role) || role === 'developer';
}
