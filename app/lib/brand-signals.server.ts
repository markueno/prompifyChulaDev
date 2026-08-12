/**
 * Pull design evidence out of a landing page's HTML.
 *
 * The previous context extractor stripped `<script>`, `<style>` AND the whole `<head>` before the
 * model ever saw the page, then asked it to describe "visual style based on the copy". That is why
 * it could never report a palette or a typeface: the only place those are stated had already been
 * deleted. This keeps the head and inline CSS and reads them for concrete tokens.
 *
 * Landing page only, by design — no following of linked stylesheets. A site whose colours live
 * entirely in an external bundle (common with Tailwind builds) will yield few hex values, and the
 * prompt tells the model to say so rather than invent them.
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

    if (stack) {
      seen.add(stack);
    }
  }

  return [...seen].slice(0, 10);
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

export function extractBrandSignals(html: string, pageUrl: string): BrandSignals {
  const css = collectInlineCss(html);

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

  lines.push('', 'font-family declarations:');
  lines.push(s.fontFamilies.length ? s.fontFamilies.map(f => `  ${f}`).join('\n') : '  (none found)');

  lines.push('', 'Google Fonts families:');
  lines.push(s.googleFonts.length ? s.googleFonts.map(f => `  ${f}`).join('\n') : '  (none found)');

  if (s.hasExternalStylesheets && s.cssVariables.length === 0 && s.colors.length < 3) {
    lines.push(
      '',
      'NOTE: this page loads external stylesheets that were not fetched, so little CSS was visible.',
      'Do not guess hex values you cannot see — say they could not be determined.'
    );
  }

  lines.push('', '## PAGE COPY', s.bodyText);

  return lines.join('\n');
}
