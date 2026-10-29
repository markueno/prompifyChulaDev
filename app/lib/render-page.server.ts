/**
 * Render a page in a headless browser, for the sites whose design is invisible to a plain fetch.
 *
 * After the static extractor learned to read modern colour syntaxes, one class of site still came
 * back with no palette and no typeface: the ones that never ship CSS as CSS. A styled-components
 * or emotion app injects its rules into `<style>` elements at runtime, and a fully client-rendered
 * marketing page serves a near-empty `<body>`. Fetching the HTML gets you a script tag.
 *
 * Rendering fixes both at once, because the injected `<style>` blocks and the real copy are both
 * present in the rendered DOM — which the existing extractor already knows how to read. So this
 * module's only job is to hand back rendered HTML; nothing downstream needs to change.
 *
 * It is a fallback, not the default path. A render costs a second or two and a few hundred MB in
 * the browser container, against a few milliseconds for a fetch, and most sites need no help at
 * all. `shouldRender` decides, and every failure here is non-fatal: the caller keeps whatever the
 * static pass found.
 *
 * Deployment: a `browserless/chromium` sidecar on the compose network, with its own memory limit
 * so a browser OOM cannot reach the app container. Set BROWSER_RENDER_URL to enable it; left
 * unset, the fallback is simply skipped and the feature behaves exactly as before.
 */
import { readCapped } from './safe-fetch.server';
import type { BrandSignals } from './brand-signals.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('render-page');

/** Rendered DOM only has to be big enough to hold the head, the injected CSS and the copy. */
const MAX_RENDERED_BYTES = 2_500_000;

/** A render that has not finished by now is not going to earn its wait. */
const DEFAULT_TIMEOUT_MS = 20_000;

export interface RenderConfig {
  /** Base URL of the render service, e.g. `http://chromium:3000`. */
  endpoint: string;
  /** Browserless `--token`, when the sidecar is started with one. */
  token?: string;
  timeoutMs?: number;
}

/**
 * Read the render service out of the environment.
 *
 * `serverEnv` first, so a Cloudflare-style binding wins, then `process.env` for the Node/EulerOS
 * deployment — the same order base-provider.ts uses to find API keys.
 */
export function getRenderConfig(serverEnv?: Record<string, string>): RenderConfig | null {
  const endpoint = serverEnv?.BROWSER_RENDER_URL || process?.env?.BROWSER_RENDER_URL;

  if (!endpoint) {
    return null;
  }

  const token = serverEnv?.BROWSER_RENDER_TOKEN || process?.env?.BROWSER_RENDER_TOKEN;
  const configured = Number(serverEnv?.BROWSER_RENDER_TIMEOUT_MS || process?.env?.BROWSER_RENDER_TIMEOUT_MS);

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    token: token || undefined,
    timeoutMs: Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * How much usable design evidence a pass produced. Used to compare the static and rendered passes
 * rather than trusting the render blindly: rendering can also go backwards (a consent wall, a bot
 * check, a hydration error leaving a blank root), and when it does the static result was better.
 */
export function signalStrength(s: BrandSignals): number {
  const colourTokens = s.cssVariables.filter(v => v.hex).length;
  const typefaces = s.fontFaces.length + s.googleFonts.length + s.fontFamilies.length;

  // Tokens are the strongest palette evidence, so they count for more than a loose colour.
  return colourTokens * 3 + s.colors.length * 2 + typefaces * 2 + (s.bodyText.length >= 100 ? 1 : 0);
}

/**
 * Whether the static pass left a gap worth a render.
 *
 * Either half missing is enough: the palette and the typefaces are the two things people actually
 * take from this document, so a page with colours but no named typeface is still a failure.
 */
export function shouldRender(s: BrandSignals): boolean {
  const hasColour = s.colors.length > 0 || s.cssVariables.some(v => v.hex);
  const hasTypeface = s.fontFaces.length > 0 || s.googleFonts.length > 0 || s.fontFamilies.length > 0;
  const hasCopy = s.bodyText.length >= 100;

  return !hasColour || !hasTypeface || !hasCopy;
}

/**
 * Fetch the rendered DOM for `pageUrl`.
 *
 * Returns null on any failure, by design — this runs behind a static pass that already produced
 * something, so a render service that is down, slow or misconfigured must degrade to the old
 * behaviour rather than fail the request.
 *
 * `pageUrl` must already have passed assertPublicHttpUrl; the caller validates it before the
 * static fetch. The endpoint itself is deliberately NOT run through that check: it is operator
 * configuration naming an internal service, and `http://chromium:3000` or a loopback address is
 * exactly the legitimate value that check exists to reject for user input.
 */
export async function renderPage(pageUrl: string, config: RenderConfig): Promise<string | null> {
  const target = new URL(`${config.endpoint}/content`);

  if (config.token) {
    target.searchParams.set('token', config.token);
  }

  const started = Date.now();

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: pageUrl,
        /*
         * `networkidle2` over `load`: runtime-injected CSS and client-rendered copy both land
         * after the load event, which is the entire reason for rendering this page at all.
         * `bestAttempt` returns the DOM as it stands when the wait expires, so a page with one
         * hanging analytics request still yields its styles.
         */
        gotoOptions: { waitUntil: 'networkidle2', timeout: config.timeoutMs },
        bestAttempt: true,
      }),
      signal: AbortSignal.timeout((config.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 5000),
    });

    if (!response.ok) {
      logger.warn(`Render service returned ${response.status} for ${pageUrl}`);
      return null;
    }

    const html = await readCapped(response, MAX_RENDERED_BYTES);

    if (html.length < 200) {
      logger.warn(`Render of ${pageUrl} produced ${html.length} bytes — ignoring`);
      return null;
    }

    logger.info(`Rendered ${pageUrl} in ${Date.now() - started}ms (${html.length} bytes)`);

    return html;
  } catch (err) {
    logger.warn(
      `Render of ${pageUrl} failed after ${Date.now() - started}ms: ${
        err instanceof Error ? err.message : 'unknown error'
      }`
    );

    return null;
  }
}
