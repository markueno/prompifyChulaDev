import { useEffect, useRef, useState } from 'react';
import { classNames } from '~/utils/classNames';

interface Workspace {
  id: string;
  name: string;
  role?: string;
  is_personal?: boolean;
}

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/companies')
      .then(r => (r.ok ? (r.json() as Promise<{ companies?: Workspace[] }>) : { companies: [] }))
      .then(d => setWorkspaces(d.companies ?? []))
      .catch(() => {});
    setActive(readCookie('active_workspace'));
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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

  const switchTo = async (id: string) => {
    setOpen(false);

    if (id === current?.id) {
      return;
    }

    await fetch('/api/workspace/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: id }),
    });
    window.location.reload();
  };

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium border border-[#fed7aa]/60 dark:border-[#423322] bg-[#f0e4d5] dark:bg-[#372a1a] text-[#231710] dark:text-[#f0e4d5] hover:border-[#f97316] hover:bg-[#fed7aa] dark:hover:bg-[#423322] transition-colors"
      >
        <span className="i-ph:buildings-duotone text-base" />
        <span className="max-w-[140px] truncate">{current?.name ?? 'Workspace'}</span>
        <span className="i-ph:caret-down text-xs opacity-70" />
      </button>

      {open ? (
        <div className="absolute left-0 z-10 mt-1 w-56 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-1 shadow-lg">
          <p className="px-2 py-1 text-xs uppercase tracking-wide text-bolt-elements-textSecondary">Workspaces</p>
          {workspaces.map(w => (
            <button
              key={w.id}
              type="button"
              onClick={() => switchTo(w.id)}
              className={classNames(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-bolt-elements-background-depth-2',
                w.id === current?.id
                  ? 'font-semibold text-bolt-elements-textPrimary'
                  : 'text-bolt-elements-textSecondary'
              )}
            >
              <span className="truncate">
                {w.name}
                {w.is_personal ? ' (Personal)' : ''}
              </span>
              {w.id === current?.id ? <span className="i-ph:check text-sm" /> : null}
            </button>
          ))}
          <a
            href="/company/new"
            className="mt-1 flex items-center gap-1.5 rounded-md border-t border-bolt-elements-borderColor px-2 py-1.5 text-sm text-bolt-elements-item-contentAccent hover:bg-bolt-elements-background-depth-2"
          >
            <span className="i-ph:plus text-sm" /> Create team
          </a>
        </div>
      ) : null}
    </div>
  );
}
