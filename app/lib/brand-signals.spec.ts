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

  it('ranks colours by weighted use, so the brand colour leads', () => {
    expect(s.colors[0].hex).toBe('#f97316');
    expect(s.colors[0].score).toBeGreaterThan(1);
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
    expect(s.colors[0].hex).toBe('#7c3aed');
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

/*
 * Each case below is a convention that produced an empty palette or an empty typeface list on
 * real sites. They are the reason the extractor no longer counts raw hex frequency.
 */
describe('colour syntaxes that real sites actually ship', () => {
  const page = (css: string) =>
    `<html><head><style>${css}</style></head><body><p>${'Marketing copy. '.repeat(20)}</p></body></html>`;

  it('reads bare HSL triplets, the shadcn/ui token convention', () => {
    const s = extractBrandSignals(
      page(`:root{--primary:221.2 83.2% 53.3%;--radius:0.5rem}.btn{background:hsl(var(--primary))}`),
      'https://x.example/'
    );

    // Tailwind's blue-600 — the channels shadcn ships as its default primary.
    expect(s.cssVariables.find(v => v.name === '--primary')?.hex).toBe('#2563eb');
    expect(s.colors[0].hex).toBe('#2563eb');
    expect(s.cssVariables.map(v => v.name)).not.toContain('--radius');
  });

  it('reads oklch(), which is the whole Tailwind v4 palette', () => {
    const s = extractBrandSignals(
      page(`:root{--color-brand:oklch(70.5% 0.213 47.604)}.cta{background:oklch(70.5% 0.213 47.604)}`),
      'https://x.example/'
    );

    /*
     * Tailwind v4's orange-500. It sits outside the sRGB gamut, so the red channel clamps — the
     * hex is the closest sRGB rendering, not v3's tamer #f97316.
     */
    expect(s.colors[0].hex).toBe('#ff6900');
  });

  it('reads 8-digit hex, which the old pattern could not match at all', () => {
    const s = extractBrandSignals(page(`.a{background:#f97316ff}.b{color:#1e293bcc}`), 'https://x.example/');

    expect(s.colors.map(c => c.hex)).toContain('#f97316');
  });

  it('collapses the same colour written three ways into one entry', () => {
    const s = extractBrandSignals(
      page(`.a{background:#f97316}.b{background:rgb(249,115,22)}.c{background:#f97316ff}`),
      'https://x.example/'
    );

    expect(s.colors.filter(c => c.hex === '#f97316')).toHaveLength(1);
  });

  it('keeps greys out of the brand palette', () => {
    /* The grey is used far more often — frequency ranking put it first and called it the primary. */
    const greys = Array.from({ length: 30 }, (_, i) => `.g${i}{border-color:#e5e7eb}`).join('');
    const s = extractBrandSignals(page(`${greys}.cta{background:#f97316}`), 'https://x.example/');

    expect(s.colors[0].hex).toBe('#f97316');
    expect(s.colors.map(c => c.hex)).not.toContain('#e5e7eb');
    expect(s.neutrals.map(c => c.hex)).toContain('#e5e7eb');
  });

  it('does not let shadow tokens spend the custom-property budget', () => {
    const shadows = Array.from({ length: 26 }, (_, i) => `--shadow-${i}:0 ${i}px ${i}px rgba(0,0,0,.0${i});`).join('');
    const s = extractBrandSignals(page(`:root{${shadows}--brand-primary:#f97316}`), 'https://x.example/');

    expect(s.cssVariables.map(v => v.name)).toContain('--brand-primary');
    expect(s.colors[0].hex).toBe('#f97316');
  });

  it('weights a CTA background above a one-off border', () => {
    const s = extractBrandSignals(page(`.cta{background:#f97316}.hr{border-color:#14b8a6}`), 'https://x.example/');

    expect(s.colors[0].hex).toBe('#f97316');
  });
});

describe('typeface names worth reporting', () => {
  const page = (css: string) =>
    `<html><head><style>${css}</style></head><body><p>${'Marketing copy. '.repeat(20)}</p></body></html>`;

  it('recovers the real family from a next/font build hash', () => {
    const s = extractBrandSignals(
      page(`@font-face{font-family:'__Inter_36bd41';src:url(/a.woff2)}
            @font-face{font-family:'__Inter_Fallback_36bd41';src:local('Arial')}
            body{font-family:'__Inter_36bd41','__Inter_Fallback_36bd41',sans-serif}`),
      'https://x.example/'
    );

    expect(s.fontFaces).toContain('Inter');
    expect(s.fontFaces.join(' ')).not.toContain('36bd41');
    expect(s.fontFaces.join(' ')).not.toContain('Fallback');
    expect(s.fontFamilies).toContain('Inter');
  });

  it('resolves a font stack held in a custom property', () => {
    const s = extractBrandSignals(
      page(`:root{--font-sans:"Space Grotesk",sans-serif}body{font-family:var(--font-sans)}`),
      'https://x.example/'
    );

    expect(s.fontFamilies).toContain('Space Grotesk');
  });

  it('reports only the intended face, not the fallback chain', () => {
    const s = extractBrandSignals(page(`body{font-family:"Sora",Helvetica,Arial,sans-serif}`), 'https://x.example/');

    expect(s.fontFamilies).toEqual(['Sora']);
  });

  it('ignores a pure system stack and icon fonts', () => {
    const s = extractBrandSignals(
      page(`body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
            .i{font-family:"Font Awesome 6 Free"}`),
      'https://x.example/'
    );

    expect(s.fontFamilies).toEqual([]);
  });

  it('finds Google Fonts imported from inside an external stylesheet', () => {
    const html = `<html><head><link rel=stylesheet href=/a.css></head><body><p>${'Copy. '.repeat(30)}</p></body></html>`;
    const css = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700');`;

    expect(extractBrandSignals(html, 'https://x.example/', css).googleFonts).toContain('Space Grotesk');
  });
});

describe('stylesheet selection', () => {
  it('spends the budget on theme CSS, not on resets and carousel plugins', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/css/normalize.css">
      <link rel="stylesheet" href="/css/icons.css">
      <link rel="stylesheet" href="/vendor/swiper.min.css">
      <link rel="stylesheet" href="/vendor/lightbox.css">
      <link rel="stylesheet" href="/_next/static/css/theme.8f2a.css">
      <link rel="stylesheet" href="/_next/static/css/brand-tokens.1b9c.css">
      </head><body></body></html>`;

    const urls = extractStylesheetUrls(html, 'https://x.example/', 3);

    expect(urls).toContain('https://x.example/_next/static/css/theme.8f2a.css');
    expect(urls).toContain('https://x.example/_next/static/css/brand-tokens.1b9c.css');
    expect(urls.some(u => u.includes('swiper'))).toBe(false);
  });

  it('always keeps the Google Fonts sheet, which names the typefaces', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/css/normalize.css">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora">
      </head><body></body></html>`;

    expect(extractStylesheetUrls(html, 'https://x.example/', 1)).toEqual([
      'https://fonts.googleapis.com/css2?family=Sora',
    ]);
  });
});
