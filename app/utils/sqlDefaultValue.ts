/*
 * H-3 — column defaults are USER input and end up in DDL executed with the Supabase
 * service-role key, so they must never be interpolated raw. Known-safe function defaults
 * are allowlisted per type; everything else is validated against the column type and
 * emitted as a quoted, escaped literal. Returns null when the value cannot be represented
 * safely (callers should reject the request with a 400).
 */
const FUNCTION_DEFAULTS: Record<string, Set<string>> = {
  timestamptz: new Set(['now()']),
  uuid: new Set(['gen_random_uuid()']),
};

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function formatDefaultValue(type: string, raw: string): string | null {
  const value = raw.trim();

  if (FUNCTION_DEFAULTS[type]?.has(value.toLowerCase())) {
    return value.toLowerCase();
  }

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
      // ISO-8601-ish literals only; anything else must use the allowlisted now().
      return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)
        ? quoteLiteral(value)
        : null;
    case 'text':
      // Reject control characters; single quotes are escaped by quoting.
      // eslint-disable-next-line no-control-regex
      return /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) ? null : quoteLiteral(value);
    default:
      return null;
  }
}
