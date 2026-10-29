/**
 * Parse any CSS colour the brand extractor is likely to meet, and normalise it to hex.
 *
 * The extractor used to recognise only `#rrggbb`, `#rgb` and `rgb()`. That quietly missed the
 * conventions most modern sites actually ship:
 *
 *   - `oklch()` — Tailwind v4's entire default palette
 *   - bare HSL triplets (`--primary: 221.2 83.2% 53.3%`) — the shadcn/ui convention, where the
 *     channels live in the custom property and `hsl()` is applied at the use site
 *   - `#rrggbbaa` / `#rgba` — dropped outright by a `{6}\b|{3}\b` pattern
 *   - `hsl()` / `hsla()` — named in the old variable filter but never actually parsed
 *
 * Everything is converted to hex because the generated document promises concrete hex values a
 * developer can paste, and because it gives one comparable form for de-duplication: `#f97316`,
 * `rgb(249,115,22)` and `oklch(70.5% 0.213 47.604)` are the same brand orange and must not be
 * reported as three separate colours.
 *
 * Saturation comes back with it so neutrals can be told from brand colour. Ranking on raw
 * frequency put borders and body greys above the accent, because a palette's greys are used on
 * far more elements than its primary.
 */

export interface ParsedColor {
  /** Normalised `#rrggbb`. Alpha is dropped: the palette is about hue, not opacity. */
  hex: string;
  /** HSL saturation, 0-1. */
  saturation: number;
  /** HSL lightness, 0-1. */
  lightness: number;
  /**
   * max(r,g,b) - min(r,g,b), 0-1. Needed alongside saturation because HSL saturation inflates at
   * extreme lightness: slate-100 (`#f1f5f9`) is 39% "saturated" by that measure while being, to
   * the eye, plainly grey.
   */
  chroma: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${part(r)}${part(g)}${part(b)}`;
}

/** sRGB saturation/lightness/chroma, for separating neutrals from chromatic colour. */
function slOf(r: number, g: number, b: number): { saturation: number; lightness: number; chroma: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;

  if (chroma === 0) {
    return { saturation: 0, lightness, chroma };
  }

  return { saturation: chroma / (1 - Math.abs(2 * lightness - 1)), lightness, chroma };
}

function fromRgb(r: number, g: number, b: number): ParsedColor {
  return { hex: toHex(r, g, b), ...slOf(clamp01(r), clamp01(g), clamp01(b)) };
}

/** Hue in degrees, saturation and lightness as 0-1. */
function fromHsl(h: number, s: number, l: number): ParsedColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const light = clamp01(l);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  const table: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];

  const [r, g, b] = table[Math.floor(hue / 60) % 6];

  return { hex: toHex(r + m, g + m, b + m), saturation: sat, lightness: light, chroma: c };
}

const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);

/**
 * OKLab to sRGB, via the standard LMS matrices. Covers `oklch()` once polar chroma/hue are turned
 * into a/b — that is, the whole Tailwind v4 palette.
 *
 * Out-of-gamut colours are clamped per channel rather than gamut-mapped by reducing chroma, so a
 * very vivid oklch value can shift slightly in hue: Tailwind v4's `oklch(70.5% 0.213 47.604)`
 * comes back as `#ff6900`. That is the closest sRGB rendering, and the hex is what a developer
 * will paste into a stylesheet, so the clamped value is the useful answer.
 */
function fromOklab(lightness: number, a: number, b: number): ParsedColor {
  // Cube roots of the LMS cone responses, per the OKLab definition.
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;

  return fromRgb(
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  );
}

/** Split a colour function's arguments: space- or comma-separated, trailing `/ alpha` dropped. */
function args(body: string): string[] {
  return body
    .split('/')[0]
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** A number that may carry a unit. Percentages come back as a fraction of `pctBasis`. */
function num(raw: string, pctBasis = 1): number | null {
  const m = raw.match(/^([+-]?[\d.]+)(%|deg|grad|rad|turn)?$/);

  if (!m) {
    return null;
  }

  const value = Number(m[1]);

  if (!Number.isFinite(value)) {
    return null;
  }

  switch (m[2]) {
    case '%':
      return (value / 100) * pctBasis;
    case 'grad':
      return value * 0.9;
    case 'rad':
      return (value * 180) / Math.PI;
    case 'turn':
      return value * 360;
    default:
      return value;
  }
}

function parseHex(token: string): ParsedColor | null {
  const hex = token.slice(1);

  if (!/^[0-9a-f]+$/.test(hex)) {
    return null;
  }

  // 4- and 8-digit forms carry alpha in the last channel, which we deliberately discard.
  if (hex.length === 3 || hex.length === 4) {
    return fromRgb(
      parseInt(hex[0] + hex[0], 16) / 255,
      parseInt(hex[1] + hex[1], 16) / 255,
      parseInt(hex[2] + hex[2], 16) / 255
    );
  }

  if (hex.length === 6 || hex.length === 8) {
    return fromRgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    );
  }

  return null;
}

/**
 * Parse one colour token. Returns null for anything that is not a colour, including `var(--x)`
 * references and keywords — the caller resolves those separately.
 */
export function parseCssColor(raw: string): ParsedColor | null {
  const value = raw.trim().toLowerCase();

  if (!value) {
    return null;
  }

  if (value.startsWith('#')) {
    return parseHex(value);
  }

  const fn = value.match(/^(rgba?|hsla?|oklch|oklab)\(([^)]*)\)$/);

  if (!fn) {
    return parseBareTriplet(value);
  }

  const [, name, body] = fn;
  const parts = args(body);

  if (parts.length < 3) {
    return null;
  }

  if (name === 'rgb' || name === 'rgba') {
    const [r, g, b] = parts.map(p => (p.includes('%') ? num(p, 255) : num(p)));

    return r == null || g == null || b == null ? null : fromRgb(r / 255, g / 255, b / 255);
  }

  if (name === 'hsl' || name === 'hsla') {
    const h = num(parts[0]);
    const s = num(parts[1], 1);
    const l = num(parts[2], 1);

    return h == null || s == null || l == null ? null : fromHsl(h, s, l);
  }

  if (name === 'oklch') {
    const lightness = num(parts[0], 1);
    const chroma = num(parts[1], 0.4);
    const hue = num(parts[2]);

    if (lightness == null || chroma == null || hue == null) {
      return null;
    }

    const rad = (hue * Math.PI) / 180;

    return fromOklab(lightness, chroma * Math.cos(rad), chroma * Math.sin(rad));
  }

  const lightness = num(parts[0], 1);
  const a = num(parts[1], 0.4);
  const b = num(parts[2], 0.4);

  return lightness == null || a == null || b == null ? null : fromOklab(lightness, a, b);
}

/**
 * The shadcn/ui convention: `--primary: 221.2 83.2% 53.3%` — HSL channels with no function
 * wrapper, because the use site writes `hsl(var(--primary))`. Nothing here is syntactically a
 * colour, so this is only tried on custom-property values, where the shape is unambiguous.
 */
export function parseBareTriplet(value: string): ParsedColor | null {
  const parts = args(value.trim().toLowerCase());

  if (parts.length !== 3) {
    return null;
  }

  /*
   * Hue is unitless or deg; saturation and lightness must both be percentages. Without that the
   * shape also matches `0 1px 2px`, which is a shadow, not a colour.
   */
  if (!/%$/.test(parts[1]) || !/%$/.test(parts[2]) || !/^[+-]?[\d.]+(deg)?$/.test(parts[0])) {
    return null;
  }

  const h = num(parts[0]);
  const s = num(parts[1], 1);
  const l = num(parts[2], 1);

  return h == null || s == null || l == null ? null : fromHsl(h, s, l);
}

/**
 * Near-black, near-white and unsaturated greys. Structural rather than brand colour: a site uses
 * them on far more elements than its accent, so ranking on frequency alone buries the palette.
 */
export function isNeutral(c: ParsedColor): boolean {
  return c.chroma < 0.1 || c.saturation < 0.15 || c.lightness < 0.04 || c.lightness > 0.97;
}
