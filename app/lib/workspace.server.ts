/**
 * Active-workspace resolution for B2B Phase 1.
 *
 * Identity is the user; the *workspace* (a `companies` row) is what owns billing,
 * the token pool, projects, and members. A user may belong to several workspaces;
 * the "active" one is tracked in the `active_workspace` cookie and defaults to the
 * user's personal workspace.
 */
import { getCompanyMember } from '~/lib/database';
import { personalCompanyId } from '~/lib/database-postgresql';

export const ACTIVE_WORKSPACE_COOKIE = 'active_workspace';

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');

  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const idx = part.indexOf('=');

    if (idx > 0 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }

  return null;
}

/**
 * The workspace the user is currently acting in. Reads the cookie and verifies
 * membership; falls back to the personal workspace if absent/invalid.
 */
export async function getActiveCompanyId(request: Request, user: { id: string }): Promise<string> {
  const personal = personalCompanyId(user.id);
  const cookie = readCookie(request, ACTIVE_WORKSPACE_COOKIE);

  if (cookie && cookie !== personal) {
    const member = await getCompanyMember(cookie, user.id);

    if (member) {
      return cookie;
    }
  }

  return personal;
}

/** Set-Cookie value to switch the active workspace (1 year, lax). */
export function activeWorkspaceCookie(companyId: string): string {
  return `${ACTIVE_WORKSPACE_COOKIE}=${encodeURIComponent(companyId)}; Path=/; SameSite=Lax; Max-Age=31536000`;
}
