import { Link, useLocation } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import { useActiveWorkspace } from '~/lib/hooks/useActiveWorkspace';
import { isWorkspaceOwner } from '~/lib/workspace-roles';

/**
 * Nav entry for the workspace management page.
 *
 * Shown only to an owner, and only in a real workspace — a personal workspace has one member and
 * no seats, so there is nothing to manage. The route enforces both conditions itself; this only
 * decides whether to advertise it.
 */
export function WorkspaceNavLink({ className }: { className?: string }) {
  const workspace = useActiveWorkspace();
  const location = useLocation();

  if (!workspace || workspace.is_personal || !isWorkspaceOwner(workspace.role)) {
    return null;
  }

  const active = location.pathname.startsWith('/app/workspace');

  return (
    <Link
      to="/app/workspace"
      className={classNames(
        'header-nav-workspace hidden text-sm font-medium sm:inline-block rounded-md px-2 py-1 transition-colors',
        active ? 'bg-white/10 text-white' : 'text-white/90 hover:text-white',
        className
      )}
    >
      Workspace
    </Link>
  );
}
