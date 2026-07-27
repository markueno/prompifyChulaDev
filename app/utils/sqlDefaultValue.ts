/*
 * H-3 / data-import — column defaults and imported cell values are USER input and end up
 * in SQL executed with the Supabase service-role key, so they must never be interpolated
 * raw. Values are validated against the column type and emitted as quoted, escaped
 * literals. Returns null when a value cannot be represented safely (callers should reject
 * the request with a 400).
 */
const FUNCTION_DEFAULTS: Record<string, Set<string>> = {
  timestamptz: new Set(['now()']),
  uuid: new Set(['gen_random_uuid()']),
};

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Strictly typed literal (no function calls allowed) — shared by defaults and row imports. */
export function formatLiteral(type: string, raw: string): string | null {
  const value = raw.trim();

  switch (type) {
    case 'integer':
      return /^-?\d{1,18}$/.test(value) ? value : null;
    case 'numeric':
      return /^-?\d{1,18}(\.\d{1,18})?$/.test(value) ? value : null;
    case 'boolean':
      return /^(true|false)$/i.test(value) ? value.toLowerCase() : null;
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        ? quoteLiteral(value.toLowerCase())
        : null;
    case 'jsonb':
      try {
        JSON.parse(value);
        return `${quoteLiteral(value)}::jsonb`;
      } catch {
        return null;
      }
    case 'timestamptz':
      // ISO-8601-ish literals only.
      return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)
        ? quoteLiteral(value)
        : null;
    case 'text': {
      // Reject control characters (tab/newline/CR stay allowed); quotes are escaped.
      const original = raw;

      return /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(original) ? null : quoteLiteral(original);
    }
    default:
      return null;
  }
}

/** Column DEFAULT: allowlisted per-type functions, otherwise a strict literal. */
export function formatDefaultValue(type: string, raw: string): string | null {
  const value = raw.trim();

  if (FUNCTION_DEFAULTS[type]?.has(value.toLowerCase())) {
    return value.toLowerCase();
  }

  if (type === 'text') {
    return formatLiteral(type, value);
  }

  return formatLiteral(type, raw);
}

/**
 * One imported cell → SQL literal. Accepts the JSON scalar types a parsed CSV/XLSX cell
 * can produce; null/empty becomes NULL. Returns null when the value doesn't fit the type.
 */
export function formatCellValue(type: string, value: string | number | boolean | null): string | null {
  if (value === null || value === undefined || value === '') {
    return 'NULL';
  }

  if (typeof value === 'boolean') {
    return type === 'boolean' ? String(value) : type === 'text' ? quoteLiteral(String(value)) : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }

    /*
     * String(1e21) === '1e+21' — route through the literal validator so exponent forms
     * and integer/numeric mismatches are rejected instead of interpolated.
     */
    return formatLiteral(type === 'text' ? 'text' : type, String(value));
  }

  return formatLiteral(type, value);
}
