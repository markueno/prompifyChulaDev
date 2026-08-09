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
