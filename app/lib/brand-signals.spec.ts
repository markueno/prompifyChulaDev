/*
 * The old extractor deleted <head> and <style> before analysis, which is exactly where a brand's
 * palette and typefaces are declared — so it could never report them. These tests pin the
 * behaviour that replaced it, including the "don't guess" case when a site keeps its CSS in an
 * external bundle.
 */
import { describe, expect, it } from 'vitest';
import { extractBrandSignals, formatSignalsForPrompt } from './brand-signals.server';

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
