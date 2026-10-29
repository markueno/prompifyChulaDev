/**
 * Pull design evidence out of a landing page's HTML.
 *
 * The first context extractor stripped `<script>`, `<style>` AND the whole `<head>` before the
 * model ever saw the page, then asked it to describe "visual style based on the copy". That is why
 * it could never report a palette or a typeface: the only place those are stated had already been
 * deleted. This keeps the head and inline CSS and reads them for concrete tokens.
 *
 * Still landing page only in the sense that we do not crawl the site — but we DO read the
 * stylesheets that page links, because inline CSS alone turned out to be too thin: most real
 * sites ship their palette and @font-face rules in an external bundle. Stylesheet fetching is
 * bounded and SSRF-guarded by the caller (see safe-fetch.server.ts).
 *
 * Reading the CSS was necessary but not sufficient. Three things still lost the palette and the
 * typeface on real sites, and this module exists to fix them:
 *
 *   1. Only `#rrggbb`, `#rgb` and `rgb()` were recognised. Tailwind v4 ships `oklch()`, shadcn/ui
 *      ships bare HSL triplets, and `#rrggbbaa` matched nothing — so entire palettes came back
 *      empty. Colour parsing now lives in css-color.server.ts and normalises everything to hex.
 *   2. Colours were ranked by raw frequency, which ranks borders and body greys above the accent:
 *      a palette's greys are used on far more elements than its primary. Occurrences are now
 *      weighted by the property and selector they appear in, and neutrals are reported separately
 *      from brand colour so the model cannot mistake a border grey for the primary.
 *   3. Custom properties were taken in document order and cut at 24. A design system that declares
 *      shadows first (`--shadow-1: 0 1px 2px rgba(0,0,0,.05)` contains `rgba(`, so it passed the
 *      old filter) spent the whole budget before reaching `--brand-primary`. Properties are now
 *      ranked by how brand-bearing their name is.
 */
import { isNeutral, parseBareTriplet, parseCssColor, type ParsedColor } from './css-color.server';

export interface ColorSignal {
  /** Normalised `#rrggbb`, so the same colour written three ways collapses to one entry. */
  hex: string;
  /** Weighted use — see ROLE_WEIGHTS. Not an occurrence count. */
  score: number;
  /** Shortest explanation of where it was seen, e.g. `token --brand-primary`, `background`. */
  roles: string[];
  /** Grey/near-black/near-white: structural, not brand colour. */
  neutral: boolean;
}

export interface VarSignal {
  name: string;
  value: string;
  /** Set when the value resolves to a colour, including bare HSL triplets. */
  hex: string | null;
}

export interface BrandSignals {
  title: string;
  description: string;
  themeColor: string | null;
  /** CSS custom properties, colour-bearing ones first. Most reliable palette source. */
  cssVariables: VarSignal[];
  /** Chromatic colours by weighted use — the actual palette candidates. */
  colors: ColorSignal[];
  /** Greys and near-black/white, kept apart so they cannot be read as the brand palette. */
  neutrals: ColorSignal[];
  /** Primary face per font-family stack, generics and system stacks removed. */
  fontFamilies: string[];
  /** Families declared via @font-face — where a self-hosted brand typeface shows up. */
  fontFaces: string[];
  /** Google Fonts families, which name the typeface even when the CSS is external. */
  googleFonts: string[];
  logoUrl: string | null;
  /** True when the page links external CSS. */
  hasExternalStylesheets: boolean;
  bodyText: string;
}

const MAX_BODY_TEXT = 6000;
const MAX_ITEMS = 24;
const MAX_COLORS = 14;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

function metaContent(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? decodeEntities(match[1]).trim() : null;
}

/** Everything inside <style> tags, plus every style="" attribute. */
function collectInlineCss(html: string): string {
  const blocks: string[] = [];

  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    blocks.push(m[1]);
  }

  /*
   * A style attribute is a bare declaration list. Wrap it in a synthetic rule so it reaches the
   * block-based scanners below — colours are attributed by the property and selector they appear
   * in, and a declaration floating outside any `{}` is invisible to that.
   */
  for (const m of html.matchAll(/\sstyle="([^"]*)"/gi)) {
    blocks.push(`*[style]{${m[1]}}`);
  }

  return blocks.join('\n');
}

/**
 * Selector + declaration body for every rule.
 *
 * `[^{}]+` cannot span a brace, so a rule nested in `@media`/`@supports` is matched on its own and
 * the at-rule prelude is skipped naturally. Works on minified CSS, which is what sites ship.
 */
function* ruleBlocks(css: string): Generator<{ selector: string; body: string }> {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    yield { selector: m[1].trim(), body: m[2] };
  }
}

function* declarations(body: string): Generator<{ prop: string; value: string }> {
  for (const part of body.split(';')) {
    const idx = part.indexOf(':');

    if (idx > 0) {
      yield { prop: part.slice(0, idx).trim().toLowerCase(), value: part.slice(idx + 1).trim() };
    }
  }
}

/** Names that mark a custom property as carrying brand colour rather than incidental colour. */
const BRAND_VAR = /(^|[-_])(brand|primary|secondary|accent|cta|theme|highlight|link|logo)([-_]|$)/i;

/** Names that are colour-ish but structural. Kept, ranked below brand names. */
const ROLE_VAR =
  /(colou?r|bg|background|fg|foreground|surface|text|ink|border|ring|muted|destructive|danger|success|warning|info)/i;

/** Names whose value often contains a colour but which are never a palette entry. */
const NOISE_VAR =
  /(shadow|gradient|overlay|scrim|easing|transition|duration|radius|space|spacing|size|width|height|z-|font-size|leading|tracking|blur)/i;

/**
 * Weight per CSS property. A colour used as a large fill says far more about the brand than one
 * used on a 1px border or inside a shadow, which is what frequency counting got backwards.
 */
const ROLE_WEIGHTS: Array<{ test: RegExp; weight: number; label: string }> = [
  { test: /^background(-color)?$/, weight: 4, label: 'background' },
  { test: /^background-image$/, weight: 3, label: 'gradient' },
  { test: /^(fill|stroke)$/, weight: 3, label: 'icon fill' },
  { test: /^color$/, weight: 2, label: 'text' },
  { test: /^(border|border-[a-z-]*colou?r|outline|outline-color)$/, weight: 1, label: 'border' },
  { test: /^(box-shadow|text-shadow)$/, weight: 0.25, label: 'shadow' },
];

/** Selectors that mark a rule as brand-bearing — the accent lives on the CTA, not the footnote. */
const PROMINENT_SELECTOR =
  /(btn|button|cta|primary|hero|banner|header|nav|brand|badge|chip|tag|link|accent|highlight|active|featured)/i;

function colourWeight(prop: string): { weight: number; label: string } | null {
  for (const role of ROLE_WEIGHTS) {
    if (role.test.test(prop)) {
      return { weight: role.weight, label: role.label };
    }
  }

  return null;
}

/** Colour-shaped tokens in a declaration value: hex, any colour function, or a bare triplet. */
function colourTokens(value: string): string[] {
  const tokens: string[] = [];

  for (const m of value.matchAll(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/g)) {
    tokens.push(m[0]);
  }

  return tokens;
}

/**
 * Custom properties, colour-bearing first.
 *
 * `value` is kept verbatim so the model can see the site's own token names and units, with the
 * resolved hex beside it — a bare `221.2 83.2% 53.3%` means nothing to a developer on its own.
 */
function extractCssVariables(css: string): VarSignal[] {
  const seen = new Map<string, VarSignal>();

  for (const { body } of ruleBlocks(css)) {
    for (const { prop, value } of declarations(body)) {
      if (!prop.startsWith('--') || seen.has(prop)) {
        continue;
      }

      const trimmed = value.slice(0, 60);
      const parsed = parseCssColor(trimmed) ?? parseBareTriplet(trimmed);
      const looksVisual = parsed !== null || /['"][^'"]+['"]|,\s*(sans-serif|serif|monospace)/i.test(trimmed);

      if (looksVisual) {
        seen.set(prop, { name: prop, value: trimmed, hex: parsed?.hex ?? null });
      }
    }
  }

  const rank = (v: VarSignal) => {
    if (v.hex && BRAND_VAR.test(v.name) && !NOISE_VAR.test(v.name)) {
      return 0;
    }

    if (v.hex && !NOISE_VAR.test(v.name)) {
      return ROLE_VAR.test(v.name) ? 1 : 2;
    }

    if (!v.hex) {
      return 3; // font stacks and the like
    }

    return 4; // a colour inside a shadow/gradient token
  };

  return [...seen.values()]
    .map((v, i) => ({ v, i, r: rank(v) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, MAX_ITEMS)
    .map(e => e.v);
}

/**
 * Colours by weighted use, split into brand colour and neutrals.
 *
 * Each occurrence scores by the property it sets and the selector it sets it on, and a colour
 * declared as a brand-named token gets a large boost — a token is a deliberate statement about
 * the palette, whereas one `border-color` is not.
 */
function extractColors(css: string, themeColor: string | null): { colors: ColorSignal[]; neutrals: ColorSignal[] } {
  const found = new Map<string, { parsed: ParsedColor; score: number; roles: Set<string> }>();

  const add = (parsed: ParsedColor, score: number, role: string) => {
    const entry = found.get(parsed.hex) ?? { parsed, score: 0, roles: new Set<string>() };
    entry.score += score;

    if (entry.roles.size < 4) {
      entry.roles.add(role);
    }

    found.set(parsed.hex, entry);
  };

  for (const { selector, body } of ruleBlocks(css)) {
    const prominence = PROMINENT_SELECTOR.test(selector) ? 2 : 1;

    for (const { prop, value } of declarations(body)) {
      if (prop.startsWith('--')) {
        const parsed = parseCssColor(value) ?? parseBareTriplet(value);

        if (!parsed) {
          continue;
        }

        if (NOISE_VAR.test(prop)) {
          add(parsed, 0.25, `in ${prop}`);
        } else {
          add(parsed, BRAND_VAR.test(prop) ? 16 : 8, `token ${prop}`);
        }

        continue;
      }

      const role = colourWeight(prop);

      if (!role) {
        continue;
      }

      for (const token of colourTokens(value)) {
        const parsed = parseCssColor(token);

        if (parsed) {
          add(parsed, role.weight * prominence, role.label);
        }
      }
    }
  }

  // A declared theme-color is the site telling the browser its brand colour. Trust it highly.
  if (themeColor) {
    const parsed = parseCssColor(themeColor);

    if (parsed) {
      add(parsed, 14, 'meta theme-color');
    }
  }

  const all = [...found.values()]
    .map(e => ({
      hex: e.parsed.hex,
      score: Math.round(e.score * 100) / 100,
      roles: [...e.roles],
      neutral: isNeutral(e.parsed),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    colors: all.filter(c => !c.neutral).slice(0, MAX_COLORS),
    neutrals: all.filter(c => c.neutral).slice(0, 8),
  };
}

/** Stacks that are a system-font fallback chain rather than a brand choice. */
const SYSTEM_STACK =
  /^\s*["']?(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded)/i;

const GENERIC_FACE = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'helvetica neue',
  'helvetica',
  'arial',
  'apple color emoji',
  'segoe ui emoji',
  'segoe ui symbol',
  'noto color emoji',
  'inherit',
  'initial',
  'unset',
  'revert',
]);

/** Fonts that are an icon set, not a typeface the brand reads in. */
const ICON_FONT =
  /^(font\s*awesome|fontawesome|fa[-_]|material\s*icons|material\s*symbols|glyphicons|ionicons|feather|bootstrap-?icons|remixicon|icomoon|icons?$)/i;

/**
 * Next.js `next/font` emits obfuscated families — `__Inter_36bd41`, plus a `__Inter_Fallback_*`
 * twin. Reported verbatim, the document named the build hash as the brand typeface.
 */
function normaliseFamily(raw: string): string | null {
  let name = raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();

  const nextFont = name.match(/^__(.+?)_(?:Fallback_)?[0-9a-z]{4,}$/i);

  if (nextFont) {
    if (/_Fallback_/i.test(name)) {
      return null; // the fallback twin is never the brand face
    }

    name = nextFont[1].replace(/_/g, ' ');
  }

  if (!name || GENERIC_FACE.has(name.toLowerCase()) || ICON_FONT.test(name) || /^var\(/i.test(name)) {
    return null;
  }

  return name.slice(0, 60);
}

/** The intended face in a font-family stack: the first entry that is not a fallback. */
function primaryFace(stack: string): string | null {
  if (SYSTEM_STACK.test(stack)) {
    return null;
  }

  for (const part of stack.split(',')) {
    const name = normaliseFamily(part);

    if (name) {
      return name;
    }
  }

  return null;
}

/**
 * Resolve one level of `var(--x)` in a font-family stack. shadcn-style setups declare
 * `--font-sans: Inter` and then every rule reads `font-family: var(--font-sans)`, so without this
 * the only thing visible is the variable name.
 */
function resolveVars(value: string, vars: Map<string, string>): string {
  return value.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)/g, (whole, name) => vars.get(name) ?? whole);
}

function extractFontFamilies(css: string, vars: Map<string, string>): string[] {
  const seen = new Set<string>();

  for (const m of css.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
    const face = primaryFace(resolveVars(m[1], vars).slice(0, 200));

    if (face) {
      seen.add(face);
    }
  }

  // `font: 600 1rem/1.4 Inter, sans-serif` — the shorthand also names the family.
  for (const m of css.matchAll(/(?:^|[;{])\s*font\s*:\s*[^;{}]*?\d[^;{}]*?\s([a-z"'][^;{}]+)/gi)) {
    const face = primaryFace(resolveVars(m[1], vars).slice(0, 200));

    if (face) {
      seen.add(face);
    }
  }

  return [...seen].slice(0, 12);
}

/**
 * Typefaces the site actually ships, from @font-face rules. More reliable than font-family
 * stacks, which are full of fallbacks — a self-hosted brand font only appears here.
 */
function extractFontFaces(css: string): string[] {
  const seen = new Set<string>();

  for (const block of css.matchAll(/@font-face\s*{([^}]*)}/gi)) {
    const family = block[1].match(/font-family\s*:\s*([^;}]+)/i);

    if (!family) {
      continue;
    }

    const name = normaliseFamily(family[1]);

    if (name) {
      seen.add(name);
    }
  }

  return [...seen].slice(0, 12);
}

/**
 * Google Fonts families, from both the HTML and the CSS.
 *
 * The CSS half matters: an `@import url(fonts.googleapis.com/...)` inside a stylesheet was
 * invisible, because only the HTML was ever scanned for the link.
 */
function extractGoogleFonts(sources: string): string[] {
  const families = new Set<string>();

  for (const m of sources.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>)]+)/gi)) {
    for (const f of m[1].matchAll(/family=([^&:]+)/g)) {
      const name = normaliseFamily(decodeURIComponent(f[1]).replace(/\+/g, ' '));

      if (name) {
        families.add(name);
      }
    }
  }

  return [...families].slice(0, 10);
}

/** Sheets that are reset, vendor or icon CSS: fetched, they crowd out the sheet with the palette. */
const LOW_VALUE_SHEET =
  /(normalize|reset|sanitize|preflight|bootstrap-grid|swiper|slick|lightbox|aos|animate|flickity|owl-?carousel|magnific|fancybox|select2|datatables|icon|fontawesome|print|cookie|consent|gdpr)/i;

/** Sheets that usually hold the design tokens. */
const HIGH_VALUE_SHEET = /(theme|brand|token|design|global|main|app|style|site|index|tailwind|custom|variables|root)/i;

/**
 * Stylesheet URLs the page links, ranked so the budget is spent on the sheets likely to hold the
 * palette.
 *
 * Document order was the wrong heuristic: a bundler-built page commonly links normalize, icons
 * and a couple of carousel plugins before its own theme CSS, so a limit of four fetched four
 * sheets containing no brand information at all and the palette came back empty.
 *
 * Google Fonts CSS is always kept: fetching it yields the @font-face rules naming the real
 * families, often the only place a typeface is stated.
 */
export function extractStylesheetUrls(html: string, pageUrl: string, limit = 6): string[] {
  const candidates: Array<{ url: string; rank: number; order: number }> = [];
  const seen = new Set<string>();

  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag[0])) {
      continue;
    }

    const href = tag[0].match(/href=["']([^"']+)["']/i);

    if (!href) {
      continue;
    }

    let absolute: string;

    try {
      absolute = new URL(decodeEntities(href[1]), pageUrl).toString();
    } catch {
      continue; // malformed href
    }

    if (seen.has(absolute)) {
      continue;
    }

    seen.add(absolute);

    const isFonts = /fonts\.googleapis\.com/i.test(absolute);
    const path = absolute.replace(/^https?:\/\/[^/]+/i, '');

    let rank = 2;

    if (isFonts) {
      rank = 0;
    } else if (LOW_VALUE_SHEET.test(path)) {
      rank = 4;
    } else if (HIGH_VALUE_SHEET.test(path)) {
      rank = 1;
    }

    candidates.push({ url: absolute, rank, order: candidates.length });
  }

  return candidates
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(c => c.url);
}

function extractBodyText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BODY_TEXT);
}

export function extractBrandSignals(html: string, pageUrl: string, externalCss = ''): BrandSignals {
  /*
   * Inline CSS alone is rarely enough — most sites ship their palette and @font-face rules in an
   * external bundle. externalCss is the concatenated content of the page's stylesheets.
   */
  const css = `${collectInlineCss(html)}\n${externalCss}`;

  const logoRaw =
    metaContent(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    metaContent(html, /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i);

  let logoUrl: string | null = null;

  if (logoRaw) {
    try {
      logoUrl = new URL(logoRaw, pageUrl).toString();
    } catch {
      logoUrl = null;
    }
  }

  const themeColor = metaContent(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);
  const cssVariables = extractCssVariables(css);
  const { colors, neutrals } = extractColors(css, themeColor);
  const varValues = new Map(cssVariables.map(v => [v.name, v.value]));

  return {
    title: metaContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? '',
    description:
      metaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      metaContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
      '',
    themeColor,
    cssVariables,
    colors,
    neutrals,
    fontFamilies: extractFontFamilies(css, varValues),
    fontFaces: extractFontFaces(css),
    googleFonts: extractGoogleFonts(`${html}\n${externalCss}`),
    logoUrl,
    hasExternalStylesheets: /<link\b[^>]*rel=["']?[^"'>]*stylesheet/i.test(html),
    bodyText: extractBodyText(html),
  };
}

/** Render the signals as the evidence block handed to the model. */
export function formatSignalsForPrompt(s: BrandSignals): string {
  const lines: string[] = ['## OBSERVED SIGNALS (extracted from the page — treat as fact)'];

  lines.push(`Page title: ${s.title || '(none)'}`);
  lines.push(`Meta description: ${s.description || '(none)'}`);
  lines.push(`theme-color: ${s.themeColor ?? '(none)'}`);
  lines.push(`Logo/OG image: ${s.logoUrl ?? '(none)'}`);

  const colourVars = s.cssVariables.filter(v => v.hex);
  const otherVars = s.cssVariables.filter(v => !v.hex);

  lines.push('', 'Design tokens that resolve to a colour (strongest palette signal):');
  lines.push(
    colourVars.length ? colourVars.map(v => `  ${v.name}: ${v.value}  ->  ${v.hex}`).join('\n') : '  (none found)'
  );

  lines.push('', 'Brand colours, by weighted use (tokens and fills outrank borders and shadows):');
  lines.push(
    s.colors.length
      ? s.colors.map(c => `  ${c.hex}  (weight ${c.score}; ${c.roles.join(', ') || 'unattributed'})`).join('\n')
      : '  (none found)'
  );

  lines.push('', 'Neutrals — greys and near-black/white. STRUCTURE, NOT BRAND COLOUR:');
  lines.push(s.neutrals.length ? s.neutrals.map(c => `  ${c.hex} (weight ${c.score})`).join('\n') : '  (none found)');

  lines.push('', 'Typefaces shipped via @font-face (strongest typography signal):');
  lines.push(s.fontFaces.length ? s.fontFaces.map(f => `  ${f}`).join('\n') : '  (none found)');

  lines.push('', 'Typefaces named in font-family declarations (fallbacks already removed):');
  lines.push(s.fontFamilies.length ? s.fontFamilies.map(f => `  ${f}`).join('\n') : '  (none found)');

  lines.push('', 'Google Fonts families:');
  lines.push(s.googleFonts.length ? s.googleFonts.map(f => `  ${f}`).join('\n') : '  (none found)');

  if (otherVars.length) {
    lines.push('', 'Other design tokens (non-colour):');
    lines.push(otherVars.map(v => `  ${v.name}: ${v.value}`).join('\n'));
  }

  const noColour = colourVars.length === 0 && s.colors.length === 0;
  const noType = s.fontFaces.length === 0 && s.fontFamilies.length === 0 && s.googleFonts.length === 0;

  if (noColour || noType) {
    lines.push('', 'NOTE: little CSS was readable for this site (styles may be injected at runtime or built into JS).');

    if (noColour) {
      lines.push('Do not guess hex values you cannot see — say the palette could not be determined.');
    }

    if (noType) {
      lines.push('Do not guess typefaces — say typography could not be determined.');
    }
  }

  lines.push('', '## PAGE COPY', s.bodyText);

  return lines.join('\n');
}
