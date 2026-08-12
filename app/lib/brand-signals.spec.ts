/*
 * The old extractor deleted <head> and <style> before analysis, which is exactly where a brand's
 * palette and typefaces are declared — so it could never report them. These tests pin the
 * behaviour that replaced it, including the "don't guess" case when a site keeps its CSS in an
 * external bundle.
 */
import { describe, expect, it } from 'vitest';
import { extractBrandSignals, formatSignalsForPrompt, extractStylesheetUrls } from './brand-signals.server';

const RICH_PAGE = `
<!doctype html>
<html>
  <head>
    <title>Acme — Warehouse software</title>
    <meta name="description" content="Inventory for growing teams" />
    <meta name="theme-color" content="#0f172a" />
    <meta property="og:image" content="/logo.png" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Fraunces" />
    <style>
      :root {
        --brand-primary: #f97316;
        --brand-ink: #231710;
        --space-4: 16px;
      }
      body { font-family: "Inter", system-ui, sans-serif; color: #231710; }
      .cta { background: #f97316; }
      .badge { background: #f97316; }
    </style>
  </head>
  <body>
    <h1>Run your warehouse without the spreadsheets</h1>
    <p>Acme gives operations teams live stock levels, purchase orders and supplier tracking in one place.
       Built for teams who outgrew manual counts but do not want a six month ERP rollout.</p>
  </body>
</html>`;

describe('extractBrandSignals', () => {
  const s = extractBrandSignals(RICH_PAGE, 'https://acme.example/');

  it('reads CSS custom properties, which are the most reliable palette source', () => {
    const names = s.cssVariables.map(v => v.name);
    expect(names).toContain('--brand-primary');
    expect(s.cssVariables.find(v => v.name === '--brand-primary')?.value).toBe('#f97316');
  });

  it('ignores non-visual custom properties', () => {
    expect(s.cssVariables.map(v => v.name)).not.toContain('--space-4');
  });

  it('ranks colours by how often they appear', () => {
    expect(s.colors[0].value).toBe('#f97316');
    expect(s.colors[0].count).toBeGreaterThan(1);
  });

  it('picks up typefaces from both CSS and the Google Fonts link', () => {
    expect(s.fontFamilies.join(' ')).toContain('Inter');
    expect(s.googleFonts).toContain('Inter');
    expect(s.googleFonts).toContain('Fraunces');
  });

  it('captures head metadata and resolves the logo to an absolute URL', () => {
    expect(s.title).toBe('Acme — Warehouse software');
    expect(s.themeColor).toBe('#0f172a');
    expect(s.logoUrl).toBe('https://acme.example/logo.png');
  });

  it('still extracts readable body copy', () => {
    expect(s.bodyText).toContain('Run your warehouse');
    expect(s.bodyText).not.toContain('<h1>');
  });
});

describe('external stylesheets', () => {
  // The real-world failure: a site whose CSS lives entirely in a linked bundle.
  const EXTERNAL_PAGE = `<html><head><title>Bundled</title>
    <link rel="stylesheet" href="/assets/app.abc123.css" />
    <link rel="preload" href="/x.js" as="script" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora" />
    </head><body><p>${'Copy about the product. '.repeat(10)}</p></body></html>`;

  it('finds the linked stylesheets and resolves them absolutely', () => {
    const urls = extractStylesheetUrls(EXTERNAL_PAGE, 'https://bundled.example/');

    expect(urls).toContain('https://bundled.example/assets/app.abc123.css');
    expect(urls).toContain('https://fonts.googleapis.com/css2?family=Sora');
    expect(urls.some(u => u.endsWith('/x.js'))).toBe(false); // preload, not a stylesheet
  });

  it('reads the palette and typefaces once the bundle is supplied', () => {
    const bundle = `
      :root { --color-brand: #7c3aed; --color-ink: #111827; }
      @font-face { font-family: "Sora"; src: url(/f/sora.woff2) format('woff2'); }
      .btn { background: #7c3aed; }
      body { font-family: Sora, system-ui, sans-serif; }`;

    const s = extractBrandSignals(EXTERNAL_PAGE, 'https://bundled.example/', bundle);

    expect(s.cssVariables.map(v => v.name)).toContain('--color-brand');
    expect(s.colors[0].value).toBe('#7c3aed');
    expect(s.fontFaces).toContain('Sora');

    // and the model is no longer warned off, because there is real evidence now
    expect(formatSignalsForPrompt(s)).not.toContain('could not be determined');
  });

  it('still warns about colour when the bundle could not be read', () => {
    const prompt = formatSignalsForPrompt(extractBrandSignals(EXTERNAL_PAGE, 'https://bundled.example/', ''));

    expect(prompt).toContain('Do not guess hex values');

    /*
     * ...but NOT about typography: the page links Google Fonts, so the typeface is known from the
     * markup alone even with zero CSS. The two warnings are independent on purpose.
     */
    expect(prompt).not.toContain('Do not guess typefaces');
  });

  it('warns about typography only when nothing names a typeface', () => {
    const noFonts = `<html><head><title>Nothing</title>
      <link rel="stylesheet" href="/a.css" /></head>
      <body><p>${'Copy about the product. '.repeat(10)}</p></body></html>`;

    expect(formatSignalsForPrompt(extractBrandSignals(noFonts, 'https://x.example/', ''))).toContain(
      'Do not guess typefaces'
    );
  });
});

describe('formatSignalsForPrompt', () => {
  it('warns the model not to invent colours when the CSS is external', () => {
    const bare = `<html><head><title>Bare</title>
      <link rel="stylesheet" href="/assets/app.css" /></head>
      <body><p>${'Some marketing copy about the product. '.repeat(10)}</p></body></html>`;

    const prompt = formatSignalsForPrompt(extractBrandSignals(bare, 'https://bare.example/'));

    expect(prompt).toContain('Do not guess hex values');
  });

  it('does not warn when plenty of colour was found', () => {
    expect(formatSignalsForPrompt(extractBrandSignals(RICH_PAGE, 'https://acme.example/'))).not.toContain(
      'Do not guess hex values'
    );
  });
});
