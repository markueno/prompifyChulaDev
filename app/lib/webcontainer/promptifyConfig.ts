import type { WebContainer } from '@webcontainer/api';
import { chatId } from '~/lib/persistence';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PromptifyConfig');

/*
 * Inject `window.__PROMPIFY_CONFIG` into the running preview so generated apps can reach the
 * Prompify data proxy LIVE — the same wiring api.deploy.ts gives DEPLOYED apps, but for the
 * in-IDE preview (which previously got no config, so its data fetches hit undefined/undefined
 * and fell back to mock data).
 *
 * The preview runs cross-origin at *.webcontainer-api.io, so `apiUrl` is the ABSOLUTE public
 * Prompify origin (window.location.origin); the data-proxy route CORS-allows the webcontainer
 * origin, and the short-lived owner-scoped bearer token authorizes the requests. This is issued
 * here in the parent (which holds the session) and written into the container.
 *
 * NOTE: over a localhost SSH tunnel `window.location.origin` is `localhost:5173`, which the
 * container's own network cannot reach — so live data works on a PUBLIC origin (prod), not the
 * tunnel. Best-effort throughout: any failure just leaves the app on its mock fallback.
 */
export async function injectPromptifyConfig(webcontainer: WebContainer): Promise<void> {
  const id = chatId.get();

  if (!id || typeof window === 'undefined') {
    return;
  }

  try {
    const res = await fetch('/api/data/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: id }),
    });

    if (!res.ok) {
      logger.warn(`token request failed (${res.status}); preview keeps mock fallback`);
      return;
    }

    const { token } = (await res.json()) as { token?: string };

    if (!token) {
      return;
    }

    const config = {
      apiUrl: `${window.location.origin}/api/data`,
      chatId: id,
      token,
    };
    const content = `window.__PROMPIFY_CONFIG = ${JSON.stringify(config)};\n`;

    // Vite serves `public/` at the site root; also write root for plain static servers.
    await webcontainer.fs.writeFile('env-config.js', content).catch(() => {});

    try {
      await webcontainer.fs.mkdir('public', { recursive: true });
    } catch {
      // directory may already exist — ignore
    }

    await webcontainer.fs.writeFile('public/env-config.js', content).catch(() => {});

    logger.info(`injected __PROMPIFY_CONFIG for chat ${id}`);
  } catch (error) {
    logger.warn('failed to inject __PROMPIFY_CONFIG (preview uses mock fallback):', error);
  }
}
