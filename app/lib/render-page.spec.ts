/*
 * The render fallback is gated by two pure decisions, and both matter more than the fetch itself:
 * `shouldRender` spends a browser only when the cheap path left a gap, and `signalStrength`
 * decides whether what came back is actually better. Getting the second one wrong would let a
 * consent wall overwrite a perfectly good static extraction.
 */
import { describe, expect, it } from 'vitest';
import { extractBrandSignals } from './brand-signals.server';
import { getRenderConfig, shouldRender, signalStrength } from './render-page.server';

const page = (head: string, body = 'Marketing copy about the product. '.repeat(10)) =>
  `<html><head>${head}</head><body><p>${body}</p></body></html>`;

/** A site that states its design in CSS — the case the static pass already handles. */
const READABLE = page(
  `<style>:root{--brand-primary:#f97316}body{font-family:"Inter",sans-serif}.cta{background:#f97316}</style>`
);

/** A client-rendered app: a script tag, an empty root, no CSS and no copy. */
const JS_ONLY = `<html><head><title>App</title><script src="/bundle.js"></script></head>
  <body><div id="root"></div></body></html>`;

describe('shouldRender', () => {
  it('does not spend a render when the page already states its palette and typeface', () => {
    expect(shouldRender(extractBrandSignals(READABLE, 'https://x.example/'))).toBe(false);
  });

  it('renders a client-rendered page that ships no CSS at all', () => {
    expect(shouldRender(extractBrandSignals(JS_ONLY, 'https://x.example/'))).toBe(true);
  });

  it('renders when the palette is known but no typeface is', () => {
    const colourOnly = page(`<style>:root{--brand-primary:#f97316}.cta{background:#f97316}</style>`);

    expect(shouldRender(extractBrandSignals(colourOnly, 'https://x.example/'))).toBe(true);
  });

  it('renders when the typeface is known but no colour is', () => {
    const typeOnly = page(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora">`);

    expect(shouldRender(extractBrandSignals(typeOnly, 'https://x.example/'))).toBe(true);
  });

  it('renders when the copy is too thin to describe a voice', () => {
    const noCopy = page(`<style>:root{--brand-primary:#f97316}body{font-family:Inter}</style>`, 'Hi');

    expect(shouldRender(extractBrandSignals(noCopy, 'https://x.example/'))).toBe(true);
  });
});

describe('signalStrength', () => {
  it('rates a readable page above one that ships nothing', () => {
    const readable = signalStrength(extractBrandSignals(READABLE, 'https://x.example/'));
    const empty = signalStrength(extractBrandSignals(JS_ONLY, 'https://x.example/'));

    expect(readable).toBeGreaterThan(empty);
  });

  it('rates runtime-injected CSS above the pre-render HTML, so the render is adopted', () => {
    /* What emotion/styled-components put in the DOM once the page has executed. */
    const hydrated = `<html><head><title>App</title>
      <style data-emotion="css">.css-1x{background:#7c3aed}.css-2y{font-family:"Sora",sans-serif}</style>
      </head><body><div id="root"><h1>Welcome</h1><p>${'Real copy now visible. '.repeat(10)}</p></div></body></html>`;

    const before = signalStrength(extractBrandSignals(JS_ONLY, 'https://x.example/'));
    const after = signalStrength(extractBrandSignals(hydrated, 'https://x.example/'));

    expect(after).toBeGreaterThan(before);
  });

  it('does not rate a consent wall above a readable static page', () => {
    /* A render can go backwards: this is what an interstitial leaves behind. */
    const consentWall = `<html><head><title>Before you continue</title></head>
      <body><h1>We value your privacy</h1><p>Accept cookies to continue to the site.</p></body></html>`;

    const staticPass = signalStrength(extractBrandSignals(READABLE, 'https://x.example/'));
    const rendered = signalStrength(extractBrandSignals(consentWall, 'https://x.example/'));

    expect(rendered).toBeLessThan(staticPass);
  });
});

describe('getRenderConfig', () => {
  it('is disabled unless an endpoint is configured, so the feature is opt-in', () => {
    expect(getRenderConfig({})).toBeNull();
  });

  it('reads the endpoint, token and timeout, trimming a trailing slash', () => {
    const config = getRenderConfig({
      BROWSER_RENDER_URL: 'http://chromium:3000/',
      BROWSER_RENDER_TOKEN: 'secret',
      BROWSER_RENDER_TIMEOUT_MS: '9000',
    });

    expect(config).toEqual({ endpoint: 'http://chromium:3000', token: 'secret', timeoutMs: 9000 });
  });

  it('falls back to the default timeout when the configured one is not a usable number', () => {
    const config = getRenderConfig({ BROWSER_RENDER_URL: 'http://chromium:3000', BROWSER_RENDER_TIMEOUT_MS: 'soon' });

    expect(config?.timeoutMs).toBe(20_000);
    expect(config?.token).toBeUndefined();
  });
});
