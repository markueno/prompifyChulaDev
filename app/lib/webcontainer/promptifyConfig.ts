import type { WebContainer } from '@webcontainer/api';
import { chatId } from '~/lib/persistence';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PromptifyConfig');
const TOKEN_REFRESH_INTERVAL_MS = 14 * 60 * 1000; // 14 min (token expires at 15 min)
let refreshTimerId: ReturnType<typeof setInterval> | undefined;

/*
 * Tracks which chatId writeConfig has already run for. server-ready can fire
 * multiple times across re-boots in a session; without this, each fire would
 * re-issue a token and re-write env-config.js. writeConfig is safe to repeat,
 * but re-issuing the token on every server-ready is wasteful. Reset on chat
 * switch (the refresh interval's guard clears it when chatId.get() !== id).
 */
let injectedForChatId: string | undefined;

/*
 * Guards the chatId subscription so multiple server-ready events don't stack
 * subscriptions. Reset by runInjection once it fires, or by the unsubscribe
 * inside the subscription callback.
 */
let pendingChatIdSubscription = false;

async function writeConfig(webcontainer: WebContainer, id: string): Promise<void> {
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

  await webcontainer.fs.writeFile('env-config.js', content).catch(() => {});

  try {
    await webcontainer.fs.mkdir('public', { recursive: true });
  } catch {
    // directory may already exist — ignore
  }

  await webcontainer.fs.writeFile('public/env-config.js', content).catch(() => {});
}

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
 * The token expires after 15 minutes. A 14-minute interval re-issues and re-writes
 * env-config.js so the preview never hits a stale token. The generated app only sees the latest
 * file — no iframe reload needed.
 *
 * NOTE: over a localhost SSH tunnel `window.location.origin` is `localhost:5173`, which the
 * container's own network cannot reach — so live data works on a PUBLIC origin (prod), not the
 * tunnel. Best-effort throughout: any failure just leaves the app on its mock fallback.
 */
export async function injectPromptifyConfig(webcontainer: WebContainer): Promise<void> {
  const id = chatId.get();

  if (typeof window === 'undefined') {
    return;
  }

  /*
   * Common case (in-session, post-boot): chatId is already set — provision now.
   * server-ready fired after useChatHistory finished loading, so writeConfig can
   * hit /api/data/token immediately.
   */
  if (id) {
    await runInjection(webcontainer, id);

    return;
  }

  /*
   * Refresh / cold-boot race: server-ready fired before useChatHistory set
   * chatId. Previously this branch early-returned, env-config.js was never
   * written, and the generated app 404'd on /env-config.js — so on every
   * refresh the data table rendered empty (the data was in Postgres but the
   * read path was dead). Subscribe to the chatId nanostore and run writeConfig
   * the moment chatId becomes available, then unsubscribe (one-shot).
   */
  if (pendingChatIdSubscription) {
    // A subscription is already armed for this webcontainer — don't stack.
    return;
  }

  pendingChatIdSubscription = true;

  let unsub: (() => void) | undefined;

  const fire = (nextId: string) => {
    if (!nextId) {
      return;
    }

    pendingChatIdSubscription = false;

    if (unsub) {
      unsub();
      unsub = undefined;
    }

    void runInjection(webcontainer, nextId);
  };

  unsub = chatId.subscribe(value => {
    if (value) {
      fire(value);
    }
  });

  /*
   * Edge case: chatId was set in the microtask between the synchronous read at
   * the top of this function and the subscribe() call. fire() is a no-op if
   * already armed-off, so calling it here is safe and closes the gap.
   */
  const currentNow = chatId.get();

  if (currentNow) {
    fire(currentNow);
  }
}

/*
 * Shared write-and-arm logic for both the synchronous (chatId present) and the
 * reactive (chatId became present) paths. Idempotent per chatId via
 * injectedForChatId — re-calling for the same id just re-arms the 14-min refresh
 * (writeConfig itself is safe to repeat, but re-issuing the token on every
 * server-ready is wasteful).
 */
async function runInjection(webcontainer: WebContainer, id: string): Promise<void> {
  /*
   * Idempotency guard: if writeConfig already ran for this chatId this session,
   * skip the re-write (server-ready fires on every re-boot). The 14-min token
   * refresh interval stays armed from the first run. A chat switch clears
   * injectedForChatId via the interval's currentId !== id guard below.
   */
  if (injectedForChatId === id) {
    return;
  }

  // Clear any previous timer so we don't leak intervals across chat switches.
  if (refreshTimerId !== undefined) {
    clearInterval(refreshTimerId);
    refreshTimerId = undefined;
  }

  try {
    await writeConfig(webcontainer, id);
    injectedForChatId = id;
    logger.info(`injected __PROMPIFY_CONFIG for chat ${id}`);

    refreshTimerId = setInterval(async () => {
      const currentId = chatId.get();

      if (currentId !== id) {
        clearInterval(refreshTimerId);
        refreshTimerId = undefined;
        injectedForChatId = undefined;

        return;
      }

      try {
        await writeConfig(webcontainer, id);
        logger.info(`refreshed __PROMPIFY_CONFIG token for chat ${id}`);
      } catch (error) {
        logger.warn('token refresh failed (preview keeps current token):', error);
      }
    }, TOKEN_REFRESH_INTERVAL_MS);
  } catch (error) {
    logger.warn('failed to inject __PROMPIFY_CONFIG (preview uses mock fallback):', error);
  }
}
