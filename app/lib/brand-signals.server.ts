/**
 * Pull design evidence out of a landing page's HTML.
 *
 * The previous context extractor stripped `<script>`, `<style>` AND the whole `<head>` before the
 * model ever saw the page, then asked it to describe "visual style based on the copy". That is why
 * it could never report a palette or a typeface: the only place those are stated had already been
 * deleted. This keeps the head and inline CSS and reads them for concrete tokens.
 *
 * Still landing page only in the sense that we do not crawl the site — but we DO read the
 * stylesheets that page links, because inline CSS alone turned out to be too thin: most real
 * sites ship their palette and @font-face rules in an external bundle, so the first version could
 * not name a colour or typeface for them. Stylesheet fetching is bounded and SSRF-guarded by the
 * caller (see safe-fetch.server.ts).
 */

export interface BrandSignals {
  title: string;
  description: string;
  themeColor: string | null;
  /** CSS custom properties, e.g. `--brand-primary: #f97316`. Most reliable palette source. */
  cssVariables: Array<{ name: string; value: string }>;
  /** Colours by descending frequency in inline CSS — a proxy for how central they are. */
  colors: Array<{ value: string; count: number }>;
  fontFamilies: string[];
  /** Families declared via @font-face — where a self-hosted brand typeface shows up. */
  fontFaces: string[];
  /** Google Fonts families, which name the typeface even when the CSS is external. */
  googleFonts: string[];
  logoUrl: string | null;
  /** True when the page links external CSS we deliberately did not fetch. */
  hasExternalStylesheets: boolean;
  bodyText: string;
}

const MAX_BODY_TEXT = 6000;
const MAX_ITEMS = 24;

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

  for (const m of html.matchAll(/\sstyle="([^"]*)"/gi)) {
    blocks.push(m[1]);
  }

  return blocks.join('\n');
}

function extractCssVariables(css: string): Array<{ name: string; value: string }> {
  const seen = new Map<string, string>();

  for (const m of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)/g)) {
    const name = m[1].trim();
    const value = m[2].trim().slice(0, 60);

    // Keep only visually meaningful values — skip layout numbers, easings, etc.
    if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|['"][^'"]+['"]|,\s*sans-serif|,\s*serif/i.test(value) && !seen.has(name)) {
      seen.set(name, value);
    }
  }

  return [...seen.entries()].slice(0, MAX_ITEMS).map(([name, value]) => ({ name, value }));
}

function extractColors(css: string): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  const add = (raw: string) => {
    const value = raw.toLowerCase();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  };

  for (const m of css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
    add(m[0]);
  }

  for (const m of css.matchAll(/rgba?\([^)]{3,40}\)/gi)) {
    add(m[0].replace(/\s+/g, ''));
  }

  return [...counts.entries()]
    .filter(([value]) => !/^#(fff|ffffff|000|000000)$/.test(value)) // too generic to be brand signal
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ITEMS)
    .map(([value, count]) => ({ value, count }));
}

function extractFontFamilies(css: string): string[] {
  const seen = new Set<string>();

  for (const m of css.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
    const stack = m[1].replace(/["']/g, '').trim().slice(0, 120);

    // Skip pure-generic stacks; they say nothing about the brand.
    if (stack && !/^(inherit|initial|unset|sans-serif|serif|monospace)$/i.test(stack)) {
      seen.add(stack);
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
    const family = block[1].match(/font-family\s*:\s*["']?([^;"'}]+)/i);

    if (family) {
      seen.add(family[1].trim().slice(0, 60));
    }
  }

  return [...seen].slice(0, 12);
}

function extractGoogleFonts(html: string): string[] {
  const families = new Set<string>();

  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)) {
    for (const f of m[1].matchAll(/family=([^&:]+)/g)) {
      families.add(decodeURIComponent(f[1]).replace(/\+/g, ' '));
    }
  }

  return [...families].slice(0, 10);
}

/**
 * Stylesheet URLs the page links, absolute and de-duplicated.
 *
 * Google Fonts CSS is included deliberately: fetching it yields the @font-face rules naming the
 * real families, which is often the only place a typeface is stated.
 */
export function extractStylesheetUrls(html: string, pageUrl: string, limit = 4): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag[0])) {
      continue;
    }

    const href = tag[0].match(/href=["']([^"']+)["']/i);

    if (!href) {
      continue;
    }

    try {
      const absolute = new URL(decodeEntities(href[1]), pageUrl).toString();

      if (!seen.has(absolute)) {
        seen.add(absolute);
        urls.push(absolute);
      }
    } catch {
      // Malformed href — skip it.
    }

    if (urls.length >= limit) {
      break;
    }
  }

  return urls;
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
   * external bundle, which is why the first version could not name a colour or a typeface for
   * real-world sites. externalCss is the concatenated content of the page's stylesheets.
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

  return {
    title: metaContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? '',
    description:
      metaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      metaContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
      '',
    themeColor: metaContent(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i),
    cssVariables: extractCssVariables(css),
    colors: extractColors(css),
    fontFamilies: extractFontFamilies(css),
    fontFaces: extractFontFaces(css),
    googleFonts: extractGoogleFonts(html),
    logoUrl,
    hasExternalStylesheets: /<link[^>]+rel=["']stylesheet["']/i.test(html),
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

  lines.push('', 'CSS custom properties:');
  lines.push(s.cssVariables.length ? s.cssVariables.map(v => `  ${v.name}: ${v.value}`).join('\n') : '  (none found)');

  lines.push('', 'Colours by frequency in inline CSS:');
  lines.push(s.colors.length ? s.colors.map(c => `  ${c.value} (${c.count}x)`).join('\n') : '  (none found)');

  lines.push('', 'Typefaces shipped via @font-face (strongest typography signal):');
  lines.push(s.fontFaces.length ? s.fontFaces.map(f => `  ${f}`).join('\n') : '  (none found)');

  lines.push('', 'font-family declarations (first name in each stack is the intended face):');
  lines.push(s.fontFamilies.length ? s.fontFamilies.map(f => `  ${f}`).join('\n') : '  (none found)');

  lines.push('', 'Google Fonts families:');
  lines.push(s.googleFonts.length ? s.googleFonts.map(f => `  ${f}`).join('\n') : '  (none found)');

  const noColour = s.cssVariables.length === 0 && s.colors.length < 3;
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
