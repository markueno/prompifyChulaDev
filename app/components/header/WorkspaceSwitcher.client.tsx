import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '~/utils/classNames';
import { canManageMembers, isWorkspaceOwner } from '~/lib/workspace-roles';
import { AddWorkspaceModal } from './AddWorkspaceModal.client';

interface Workspace {
  id: string;
  name: string;
  role?: string;
  is_personal?: boolean;
}

/* 'developer' still appears on rows written before the developer→editor migration. */
const ROLE_ICONS: Record<string, string> = {
  owner: 'i-ph:crown-simple-fill text-[#f97316]',
  admin: 'i-ph:shield-check-fill text-[#f97316]/80',
  editor: 'i-ph:pencil-simple',
  developer: 'i-ph:pencil-simple',
  viewer: 'i-ph:eye',
};

const ROLE_TITLES: Record<string, string> = {
  owner: 'Owner — you pay for and run this workspace',
  admin: 'Admin — you can build and manage members',
  editor: 'Editor — you can build here',
  developer: 'Editor — you can build here',
  viewer: 'Viewer — you can look, but not build',
};

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');

    if (idx > 0 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }

  return null;
}

/**
 * Workspace switcher. Lists the user's workspaces (personal + teams), shows the
 * active one (from the `active_workspace` cookie), and switches via /api/workspace/switch.
 */
export function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch('/api/companies')
      .then(r => (r.ok ? (r.json() as Promise<{ companies?: Workspace[] }>) : { companies: [] }))
      .then(d => setWorkspaces(d.companies ?? []))
      .catch(() => {});
    setActive(readCookie('active_workspace'));
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      if (ref.current && !ref.current.contains(target) && !target.closest('[data-workspace-dropdown]')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);

    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (workspaces.length === 0) {
    return null;
  }

  const personal = workspaces.find(w => w.is_personal);
  const current = workspaces.find(w => w.id === active) ?? personal ?? workspaces[0];

  /*
   * Both reload rather than updating state: the active_workspace cookie now points at something
   * the user has left or archived, and every loader on the page was rendered against it. A reload
   * lets getActiveCompanyId fall back to the personal workspace, which is the only way the rest of
   * the page ends up consistent.
   */
  const archiveWorkspace = async (workspace: Workspace) => {
    if (!confirm(`Delete "${workspace.name}"? Members lose access. Your plan and its tokens are unaffected.`)) {
      return;
    }

    setBusy(true);

    try {
      const res = await fetch('/api/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: workspace.id }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? 'That workspace could not be deleted.');
        setBusy(false);

        return;
      }

      window.location.reload();
    } catch {
      alert('That workspace could not be deleted.');
      setBusy(false);
    }
  };

  const leaveWorkspace = async (workspace: Workspace) => {
    if (!confirm(`Leave "${workspace.name}"? You will lose access to its projects.`)) {
      return;
    }

    setBusy(true);

    try {
      const res = await fetch(`/api/companies/${workspace.id}/leave`, { method: 'DELETE' });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? 'Could not leave that workspace.');
        setBusy(false);

        return;
      }

      window.location.reload();
    } catch {
      alert('Could not leave that workspace.');
      setBusy(false);
    }
  };

  const switchTo = async (id: string) => {
    setOpen(false);

    if (id === current?.id) {
      return;
    }

    try {
      await fetch('/api/workspace/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: id }),
      });
    } catch {
      /*
       * Network error — the switch may not have taken effect.
       * Reload anyway so the user sees a response (not a dead button).
       */
    }
    window.location.reload();
  };

  const toggleDropdown = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }

    setOpen(v => !v);
  };

  return (
    <div ref={ref} data-state={open ? 'open' : 'closed'} className="relative hidden sm:block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleDropdown}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium border border-[#fed7aa]/60 dark:border-[#423322] bg-[#f0e4d5] dark:bg-[#372a1a] text-[#231710] dark:text-[#f0e4d5] hover:border-[#f97316] hover:bg-[#fed7aa] dark:hover:bg-[#423322] transition-colors"
      >
        <span className="i-ph:buildings-duotone text-base" />
        <span className="max-w-[140px] truncate">{current?.name ?? 'Workspace'}</span>
        <span className="i-ph:caret-down text-xs opacity-70" />
      </button>

      {open && dropdownPos
        ? createPortal(
            <div
              data-workspace-dropdown
              className="fixed z-[9999] w-56 rounded-lg border border-[#fed7aa]/60 dark:border-[#423322] bg-[#f0e4d5] dark:bg-[#2d2014] p-1 shadow-lg"
              style={{ top: dropdownPos.top, left: dropdownPos.left }}
            >
              <p className="px-2 py-1 text-xs uppercase tracking-wide text-[#231710]/60 dark:text-[#f0e4d5]/60">
                Workspaces
              </p>
              {workspaces.map(w => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => switchTo(w.id)}
                  className={classNames(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#fed7aa] dark:hover:bg-[#423322]',
                    w.id === current?.id
                      ? 'font-semibold text-[#231710] dark:text-[#f0e4d5]'
                      : 'text-[#231710]/70 dark:text-[#f0e4d5]/80'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">
                      {w.name}
                      {w.is_personal ? ' (Personal)' : ''}
                    </span>
                    {/*
                     * Your role in each workspace, so "why can't I do anything here" is answerable
                     * without leaving the menu. Omitted for personal workspaces, where you are
                     * always the owner and the label would be noise.
                     */}
                    {!w.is_personal && w.role ? (
                      <span
                        title={ROLE_TITLES[w.role] ?? w.role}
                        className={classNames('shrink-0 text-xs', ROLE_ICONS[w.role] ?? 'i-ph:user')}
                      />
                    ) : null}
                  </span>
                  {w.id === current?.id ? <span className="i-ph:check text-sm text-[#f97316]" /> : null}
                </button>
              ))}
              {/*
               * Between the workspaces and the add button: it acts on the workspace you are in, so
               * it belongs beside them rather than in the main navbar, which is about your own work.
               * Hidden in a personal workspace — there is one member and no seats to administer.
               */}
              {canManageMembers(current?.role) && !current?.is_personal ? (
                <a
                  href="/app/workspace"
                  className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t border-[#fed7aa]/60 dark:border-[#423322] px-2 py-1.5 text-sm text-[#231710]/70 dark:text-[#f0e4d5]/80 hover:bg-[#fed7aa] dark:hover:bg-[#423322]"
                >
                  <span className="i-ph:gear text-sm" /> Workspace settings
                </a>
              ) : null}

              {/*
               * Leaving and deleting are mutually exclusive: the owner cannot leave (there is
               * nowhere to hand the workspace to) and everyone else cannot delete.
               */}
              {current && !current.is_personal ? (
                isWorkspaceOwner(current.role) ? (
                  <button
                    type="button"
                    onClick={() => archiveWorkspace(current)}
                    disabled={busy}
                    className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  >
                    <span className="i-ph:trash text-sm" /> Delete workspace
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => leaveWorkspace(current)}
                    disabled={busy}
                    className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-[#231710]/70 hover:bg-[#fed7aa] disabled:opacity-50 dark:text-[#f0e4d5]/80 dark:hover:bg-[#423322]"
                  >
                    <span className="i-ph:sign-out text-sm" /> Leave workspace
                  </button>
                )
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setShowAddModal(true);
                }}
                className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t border-[#fed7aa]/60 dark:border-[#423322] px-2 py-1.5 text-sm text-[#f97316] hover:bg-[#fed7aa] dark:hover:bg-[#423322]"
              >
                <span className="i-ph:plus text-sm" /> Add workspace
              </button>
            </div>,
            document.body
          )
        : null}

      <AddWorkspaceModal open={showAddModal} onClose={() => setShowAddModal(false)} />
    </div>
  );
}
