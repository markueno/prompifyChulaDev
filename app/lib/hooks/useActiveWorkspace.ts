import { useEffect, useState } from 'react';

export interface ActiveWorkspace {
  id: string;
  name: string;
  role?: string;
  is_personal?: boolean;
}

/**
 * The workspace the user is currently acting in, resolved the same way WorkspaceSwitcher resolves
 * it: the full list from /api/companies (which carries each membership's role and the personal
 * flag) picked by the `active_workspace` cookie.
 *
 * Client-only — it reads document.cookie — so call it under ClientOnly or accept that the first
 * render returns null. Returning null is the safe default for callers gating UI on it: a nav item
 * that appears a beat late is better than one that flashes for someone who may not be allowed it.
 */
export function useActiveWorkspace(): ActiveWorkspace | null {
  const [workspaces, setWorkspaces] = useState<ActiveWorkspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/companies')
      .then(r => (r.ok ? (r.json() as Promise<{ companies?: ActiveWorkspace[] }>) : { companies: [] }))
      .then(d => {
        if (!cancelled) {
          setWorkspaces(d.companies ?? []);
        }
      })
      .catch(() => {});

    setActiveId(readCookie('active_workspace'));

    return () => {
      cancelled = true;
    };
  }, []);

  if (workspaces.length === 0) {
    return null;
  }

  // Same fallback order as the switcher, so the two never disagree about which workspace is active.
  return workspaces.find(w => w.id === activeId) ?? workspaces.find(w => w.is_personal) ?? workspaces[0] ?? null;
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
