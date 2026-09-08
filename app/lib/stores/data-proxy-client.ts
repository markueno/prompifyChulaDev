/**
 * Client for the self-hosted Remix data proxy (no Supabase). Mirrors the
 * supabase-admin API surface so AdminDataSection can switch between the two
 * with minimal change. Same-origin in the IDE preview — the session cookie
 * authenticates; deployed apps pass a bearer token (Phase D).
 */
import type { SupabaseTable, SupabaseRow, SupabaseColumn } from '~/types/supabase-admin';

interface ProxyColumn {
  name: string;
  type: string;
}

interface ProxyTable {
  name: string;
  columns: ProxyColumn[];
  row_count?: number;
}

function toSupabaseTable(t: ProxyTable): SupabaseTable {
  const cols: SupabaseColumn[] = (t.columns || []).map(c => ({
    name: c.name,
    type: c.type,
    format: c.type,
    nullable: true,
  }));

  return {
    name: t.name,
    columns: cols,
    primaryKey: 'id',
  };
}

/** GET /api/data/:chatId/schema — list this chat's registered tables. */
export async function listProxyTables(chatId: string): Promise<SupabaseTable[]> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(chatId)}/schema`);

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as { tables?: ProxyTable[] };

    return (data.tables || []).map(toSupabaseTable);
  } catch {
    return [];
  }
}

/** GET /api/data/:chatId/:resource — list rows (page/size/sort). */
export async function fetchProxyRows(
  chatId: string,
  table: string,
  page: number,
  pageSize: number,
  sortColumn?: string,
  sortAsc?: boolean
): Promise<{ data: SupabaseRow[]; count: number; error?: string }> {
  try {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize),
    });

    if (sortColumn) {
      /*
       * The proxy currently orders by created_at DESC; sort params are passed
       * through for a future enhancement. Kept in the signature for compat.
       */
      void sortAsc;
    }

    const res = await fetch(`/api/data/${encodeURIComponent(chatId)}/${encodeURIComponent(table)}?${params}`);

    if (!res.ok) {
      const body = await res.text();

      return { data: [], count: 0, error: `HTTP ${res.status}: ${body}` };
    }

    const json = (await res.json()) as { data?: SupabaseRow[] };
    const rows = Array.isArray(json.data) ? json.data : [];

    /*
     * The proxy doesn't return a total count yet; use the page size as an
     * upper bound so the pager keeps a "next" button until the last page.
     */
    return { data: rows, count: rows.length < pageSize ? page * pageSize + rows.length : (page + 1) * pageSize + 1 };
  } catch (err) {
    return { data: [], count: 0, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}

/** POST /api/data/:chatId/:resource — insert one row. */
export async function insertProxyRow(
  chatId: string,
  table: string,
  row: SupabaseRow
): Promise<{ success: boolean; row?: SupabaseRow; error?: string }> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(chatId)}/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });

    const json = (await res.json()) as { data?: SupabaseRow; error?: string };

    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, row: json.data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Insert failed' };
  }
}

/** PATCH /api/data/:chatId/:resource?id=... — update a row by PK. */
export async function updateProxyRow(
  chatId: string,
  table: string,
  id: string,
  patch: SupabaseRow
): Promise<{ success: boolean; row?: SupabaseRow; error?: string }> {
  try {
    const res = await fetch(
      `/api/data/${encodeURIComponent(chatId)}/${encodeURIComponent(table)}?id=${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );

    const json = (await res.json()) as { data?: SupabaseRow; error?: string };

    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, row: json.data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed' };
  }
}

/** A column definition as the schema endpoint expects it. */
export interface ProxyColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
}

/** PATCH /api/data/:chatId/schema — add and/or drop columns on an existing table. */
export async function alterProxyTable(
  chatId: string,
  table: string,
  changes: { addColumns?: ProxyColumnDef[]; dropColumns?: string[] }
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(chatId)}/schema`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: table, ...changes }),
    });

    const data = (await res.json()) as { error?: string };

    if (!res.ok || data.error) {
      return { success: false, error: data.error || `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update columns' };
  }
}

/** DELETE /api/data/:chatId/schema?table=... — drop a table and deregister it. */
export async function dropProxyTable(chatId: string, table: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(chatId)}/schema?table=${encodeURIComponent(table)}`, {
      method: 'DELETE',
    });

    const data = (await res.json()) as { error?: string };

    if (!res.ok || data.error) {
      return { success: false, error: data.error || `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete table' };
  }
}

/** DELETE /api/data/:chatId/:resource?id=... — delete a row by PK. */
export async function deleteProxyRow(
  chatId: string,
  table: string,
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `/api/data/${encodeURIComponent(chatId)}/${encodeURIComponent(table)}?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );

    if (!res.ok) {
      const json = (await res.json()) as { error?: string };

      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Delete failed' };
  }
}

/** POST /api/data/:chatId/:resource/seed — bulk-insert sample rows. */
export async function seedProxyRows(
  chatId: string,
  table: string,
  rows: Record<string, unknown>[]
): Promise<{ success: boolean; inserted?: number; error?: string }> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(chatId)}/${encodeURIComponent(table)}/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });

    const json = (await res.json()) as { inserted?: number; error?: string };

    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, inserted: json.inserted };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Seed failed' };
  }
}

/** POST /api/data/:chatId/:resource/generate — LLM-generated sample rows. */
export async function generateSampleRows(
  chatId: string,
  table: string
): Promise<{ success: boolean; inserted?: number; error?: string }> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(chatId)}/${encodeURIComponent(table)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const json = (await res.json()) as { inserted?: number; error?: string };

    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }

    return { success: true, inserted: json.inserted };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Generate failed' };
  }
}

/**
 * Export a table's rows as CSV or XLSX. Fetches up to 1000 rows (the proxy's
 * MAX_ROWS cap), transforms client-side, and triggers a download. No server
 * round-trip for the transformation — papaparse (CSV) and exceljs (XLSX) are
 * already production deps used by ImportDataModal.
 */
export async function exportTableData(
  chatId: string,
  table: string,
  format: 'csv' | 'xlsx'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch all rows (up to 1000 — the proxy's cap).
    const { data, error } = await fetchProxyRows(chatId, table, 0, 1000);

    if (error) {
      return { success: false, error };
    }

    if (!data || data.length === 0) {
      return { success: false, error: 'No rows to export' };
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${table}-${dateStr}.${format}`;

    if (format === 'csv') {
      const papaparse = (await import('papaparse')).default;
      const csv = papaparse.unparse(data);
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
    } else {
      const exceljs = (await import('exceljs')).default;
      const workbook = new exceljs.Workbook();
      const sheet = workbook.addWorksheet(table);
      const headers = Object.keys(data[0]);
      sheet.columns = headers.map(h => ({ header: h, key: h }));
      sheet.addRows(data);

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        filename
      );
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Export failed' };
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
