/**
 * Pure client-side utils for the data-import feature. No React, no network —
 * unit-testable in isolation. The server fully re-validates everything these
 * produce; this module exists to give the user a sane preview before upload.
 *
 * Pipeline: raw headers/rows (from papaparse/exceljs) -> sanitize headers ->
 * unique-ify -> infer column types -> normalize rows to typed arrays aligned
 * with the column order. The server's api.import-data.ts then validates every
 * cell via formatCellValue before any DDL.
 */

const RESERVED = new Set(['id', 'created_at', 'updated_at']);

/**
 * Lowercase, spaces->`_`, strip everything that isn't [a-z0-9_], prefix `col_`
 * when it starts with a non-letter, truncate to 63 chars, fall back to
 * `col_N` for empty/all-stripped input.
 */
export function sanitizeIdentifier(raw: string, fallbackIndex = 0): string {
  let s = (raw || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  if (!s) {
    return `col_${fallbackIndex || 1}`;
  }

  if (!/^[a-z]/.test(s)) {
    s = `col_${s}`;
  }

  s = s.slice(0, 63);
  s = s.replace(/_+$/, ''); // trim trailing underscores

  return s || `col_${fallbackIndex || 1}`;
}

/**
 * Dedupe a list of names with `_2`, `_3` suffixes. Names colliding with the
 * reserved set (id/created_at/updated_at) are suffixed too — the PK + the two
 * timestamps are auto-added by the import route, so a user column named `id`
 * becomes `id_2`.
 */
export function uniqueColumnNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const original of names) {
    let candidate = original;
    let n = 2;

    /*
     * Reserved names (id/created_at/updated_at) are auto-added by the import
     * route, so a user column colliding with one is suffixed too.
     */
    while (RESERVED.has(candidate) || seen.has(candidate)) {
      candidate = `${original}_${n}`;
      n += 1;
    }

    seen.add(candidate);
    result.push(candidate);
  }

  return result;
}

const RE_INTEGER = /^-?\d{1,18}$/;
const RE_NUMERIC = /^-?\d{1,18}(\.\d{1,18})?$/;
const RE_BOOLEAN = /^(true|false)$/i;
// Same shape as sqlDefaultValue.ts timestamptz branch.
const RE_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export type ColumnType = 'text' | 'integer' | 'numeric' | 'boolean' | 'timestamptz';

/**
 * Infer a column type from up to 500 non-empty sample values. All values must
 * match the stricter type for it to be chosen; an all-empty column defaults to
 * text. Order: integer -> numeric -> boolean -> timestamptz -> text.
 */
export function inferColumnType(values: Array<string | number | boolean | null>): ColumnType {
  const samples = (values || [])
    .filter(v => v !== null && v !== undefined && v !== '')
    .slice(0, 500)
    .map(v => String(v));

  if (samples.length === 0) {
    return 'text';
  }

  if (samples.every(v => RE_INTEGER.test(v))) {
    return 'integer';
  }

  if (samples.every(v => RE_NUMERIC.test(v))) {
    return 'numeric';
  }

  if (samples.every(v => RE_BOOLEAN.test(v))) {
    return 'boolean';
  }

  if (samples.every(v => RE_TIMESTAMPTZ.test(v))) {
    return 'timestamptz';
  }

  return 'text';
}

export interface ImportColumn {
  name: string;
  type: ColumnType;
}

export interface ImportPayload {
  tableName: string;
  columns: ImportColumn[];
  rows: Array<Array<string | number | boolean | null>>;
}

/**
 * Build the normalized payload for POST /api/import-data from raw parsed data.
 * `tableName` is sanitized from the filename if the caller didn't provide one.
 * Rows are emitted as ARRAYS aligned with the column order (compact, no keys).
 */
export function buildImportPayload(
  headers: string[],
  rawRows: Array<Record<string, string | number | boolean | null>>,
  tableName?: string
): ImportPayload {
  const sanitizedHeaders = headers.map((h, i) => sanitizeIdentifier(h, i + 1));
  const finalNames = uniqueColumnNames(sanitizedHeaders);

  const columns: ImportColumn[] = finalNames.map((name, i) => {
    const sourceKey = headers[i];
    const samples = rawRows.map(r => r[sourceKey]).filter(v => v !== undefined);

    return { name, type: inferColumnType(samples) };
  });

  const rows: Array<Array<string | number | boolean | null>> = rawRows.map(row =>
    headers.map((_, i) => {
      const v = row[headers[i]];
      const col = columns[i];

      /*
       * Coerce to the inferred type where it's a clean fit; otherwise pass the
       * raw string and let the server's formatCellValue reject/accept it.
       */
      if (v === null || v === undefined || v === '') {
        return null;
      }

      if (col.type === 'boolean') {
        return /^(true|false)$/i.test(String(v)) ? String(v).toLowerCase() === 'true' : String(v);
      }

      if (col.type === 'integer' || col.type === 'numeric') {
        const n = Number(v);
        return Number.isFinite(n) && RE_NUMERIC.test(String(v)) ? n : String(v);
      }

      return v;
    })
  );

  return {
    tableName: tableName || sanitizedHeaders.slice(0, 1).join('_') || 'imported',
    columns,
    rows,
  };
}
