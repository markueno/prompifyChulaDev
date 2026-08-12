/**
 * Client access to the workspace's brand context.
 *
 * The server is the source of truth (so the context follows the account across devices and is
 * shared by the workspace), but localStorage is kept as a synchronous cache: the questionnaire
 * builds its prompt in a plain synchronous function, and making that async would ripple through
 * the whole prompt builder for no user-visible gain.
 */
export const COMPANY_CONTEXT_KEY = 'companyContext';

/** Marks that this browser has already pushed its pre-workspace localStorage copy up. */
const MIGRATED_KEY = 'companyContextMigrated';

export function readCachedContext(): string {
  try {
    return localStorage.getItem(COMPANY_CONTEXT_KEY) || '';
  } catch {
    return '';
  }
}

function writeCache(content: string): void {
  try {
    if (content) {
      localStorage.setItem(COMPANY_CONTEXT_KEY, content);
    } else {
      localStorage.removeItem(COMPANY_CONTEXT_KEY);
    }
  } catch {
    // Private mode / quota — the server copy still works.
  }
}

export async function fetchWorkspaceContext(): Promise<{ content: string; sourceUrl: string | null } | null> {
  try {
    const res = await fetch('/api/workspace-context');

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { context?: string; sourceUrl?: string | null };

    return { content: data.context ?? '', sourceUrl: data.sourceUrl ?? null };
  } catch {
    return null;
  }
}

export async function saveWorkspaceContext(content: string, sourceUrl?: string | null): Promise<boolean> {
  try {
    const res = await fetch('/api/workspace-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, sourceUrl }),
    });

    if (res.ok) {
      writeCache(content);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export async function deleteWorkspaceContext(): Promise<void> {
  writeCache('');

  try {
    await fetch('/api/workspace-context', { method: 'DELETE' });
  } catch {
    // Best effort; the next sync will reconcile.
  }
}

/**
 * Bring this browser in line with the workspace.
 *
 * Runs once per browser: any context that predates workspace storage is pushed up (with ifAbsent,
 * so it can't overwrite something a teammate already wrote), then the server copy becomes the
 * cache. Returns the authoritative content.
 */
export async function syncWorkspaceContext(): Promise<string> {
  const cached = readCachedContext();

  try {
    if (cached && !localStorage.getItem(MIGRATED_KEY)) {
      await fetch('/api/workspace-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: cached, ifAbsent: true }),
      }).catch(() => undefined);

      localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    }
  } catch {
    // localStorage unavailable — fall through to the server read.
  }

  const remote = await fetchWorkspaceContext();

  if (!remote) {
    return cached;
  }

  writeCache(remote.content);

  return remote.content;
}
