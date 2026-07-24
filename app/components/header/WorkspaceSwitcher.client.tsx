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

  const personal =
    workspaces.find(w => w.is_personal) ??
    (workspaces.length > 0 ? workspaces[0] : ({ id: 'personal', name: 'Personal', is_personal: true } as Workspace));
  const current = workspaces.find(w => w.id === active) ?? personal;

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
        className={classNames(
          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
          'border border-[#fed7aa]/60 bg-[#f0e4d5] text-[#231710]',
          'hover:border-[#f97316] hover:bg-[#fed7aa]'
        )}
      >
        <span className="w-5 h-5 rounded bg-[#f97316] flex items-center justify-center shrink-0">
          <span className="text-[10px] text-white font-bold">{(current?.name ?? 'W').charAt(0).toUpperCase()}</span>
        </span>
        <span className="max-w-[140px] truncate">{current?.name ?? 'Workspace'}</span>
        <span className="i-ph:caret-down text-xs opacity-70" />
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-1.5 w-60 rounded-xl border border-[#fed7aa]/60 bg-[#f0e4d5] p-1.5 shadow-lg">
          <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#231710]/50">Workspaces</p>
          {workspaces.map(w => (
            <button
              key={w.id}
              type="button"
              onClick={() => switchTo(w.id)}
              className={classNames(
                'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                w.id === current?.id
                  ? 'bg-[#fed7aa] font-semibold text-[#231710]'
                  : 'text-[#231710]/70 hover:bg-[#fed7aa]/50'
              )}
            >
              <span className="truncate">
                {w.name}
                {w.is_personal ? ' (Personal)' : ''}
              </span>
              {w.id === current?.id ? (
                <span className="w-4 h-4 rounded-full bg-[#f97316] flex items-center justify-center shrink-0 ml-2">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path
                      d="M1.5 4L3.5 6L6.5 2"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              ) : null}
            </button>
          ))}
          <a
            href="/company/new"
            className="mt-1.5 flex items-center gap-2 rounded-lg border-t border-[#fed7aa]/60 px-2.5 py-2 text-sm font-medium text-[#231710] hover:bg-[#fed7aa]/50 transition-colors"
          >
            <span className="i-ph:plus text-sm" /> Create team
          </a>
        </div>
      ) : null}
    </div>
  );
}
