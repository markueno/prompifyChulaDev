/**
 * Project (chat) roles and what each one is allowed to see and do.
 *
 * Deliberately the same four names as the workspace roles in `workspace-roles.ts`, because two
 * different vocabularies for the same idea is how people end up guessing. They are NOT the same
 * thing though, and the distinction matters:
 *
 *   a workspace role  says what you may do across everything in the workspace
 *   a project role    says what you may do in one project you were invited to individually
 *
 * The two meet at one rule, enforced in the database rather than here: the owner of a workspace
 * outranks the owner of any project inside it. Ownership is never transferable, for either, so
 * somebody has to be able to act on work left behind.
 *
 *   owner   created it; invites, removes, deletes, builds   — exactly one per project
 *   admin   invites and removes, builds, sees everything
 *   editor  builds; sees the code and the conversation
 *   viewer  sees the running app and nothing else
 *
 * What a viewer is kept away from is the point of the split. A project's conversation is where
 * someone typed what the business actually needs, and its code is the thing itself; showing a
 * client the working app should not hand them either.
 *
 * Safe to import on the client: no secrets, no database access.
 */

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer';

/**
 * Rows written before roles existed all say 'member', and that is what every project invitation
 * sent so far granted. Those people were told they were getting "the chat history, code, and
 * preview", and they have had it, so 'member' reads as 'editor' — the role that preserves exactly
 * what they can do today. Treating it as 'viewer' would quietly take access away from people who
 * already have it.
 */
export function normalizeProjectRole(role: string | null | undefined): ProjectRole | null {
  if (role === 'member') {
    return 'editor';
  }

  if (role === 'owner' || role === 'admin' || role === 'editor' || role === 'viewer') {
    return role;
  }

  return null;
}

/** The single project owner: whoever created it. Deleting, and full control of who else is in. */
export function isProjectOwner(role: string | null | undefined): boolean {
  return normalizeProjectRole(role) === 'owner';
}

/** Invite, remove and re-role people on this project. */
export function canManageProjectMembers(role: string | null | undefined): boolean {
  const normalized = normalizeProjectRole(role);
  return normalized === 'owner' || normalized === 'admin';
}

/**
 * Prompt in the project, edit its files, deploy it.
 *
 * Note this is about the PROJECT role only. Someone must also be allowed to build in the
 * workspace the project belongs to, and `/api/chat` checks both — a viewer in the workspace does
 * not become a builder by being made an editor on one project inside it.
 */
export function canBuildInProject(role: string | null | undefined): boolean {
  const normalized = normalizeProjectRole(role);
  return canManageProjectMembers(role) || normalized === 'editor';
}

/**
 * See the conversation and the generated code, rather than only the running app.
 *
 * The one thing a viewer is actually restricted from, and so the predicate that every loader
 * handing back messages or files has to consult. Kept separate from canBuildInProject because
 * read and write are not the same question, even though today the same roles pass both.
 */
export function canSeeProjectInternals(role: string | null | undefined): boolean {
  return canBuildInProject(role);
}

/** Roles an invitation or a role change may grant. Never `owner` — that would be a transfer. */
export const ASSIGNABLE_PROJECT_ROLES: ProjectRole[] = ['admin', 'editor', 'viewer'];

export function isAssignableProjectRole(role: string | null | undefined): role is ProjectRole {
  return ASSIGNABLE_PROJECT_ROLES.includes(role as ProjectRole);
}

/** Wording for the invite form and the members list. */
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

export const PROJECT_ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  owner: 'Created the project. Full control.',
  admin: 'Can build and manage who has access.',
  editor: 'Can build, and see the code and conversation.',
  viewer: 'Can only see the running app.',
};
