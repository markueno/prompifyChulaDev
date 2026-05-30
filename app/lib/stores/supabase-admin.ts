import type { SupabaseConfig, SupabaseTable, SupabaseRow, SupabaseColumn } from '~/types/supabase-admin';

const STORAGE_PREFIX = 'supabase_admin_config_';

export function getSupabaseConfig(chatId: string): SupabaseConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + chatId);
    return stored ? (JSON.parse(stored) as SupabaseConfig) : null;
  } catch {
    return null;
  }
}

export function saveSupabaseConfig(chatId: string, config: SupabaseConfig): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_PREFIX + chatId, JSON.stringify(config));
}

export function clearSupabaseConfig(chatId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_PREFIX + chatId);
}

function adminHeaders(config: SupabaseConfig, extra: Record<string, string> = {}): Record<string, string> {
  const key = config.serviceRoleKey || config.anonKey;
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function parseTablesFromSpec(spec: Record<string, unknown>): SupabaseTable[] {
  const definitions = (spec.definitions ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(definitions).map(([name, def]) => {
    const props = (def.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (def.required ?? []) as string[];
    const columns: SupabaseColumn[] = Object.entries(props).map(([colName, colDef]) => ({
      name: colName,
      type: String(colDef.type ?? 'unknown'),
      format: colDef.format ? String(colDef.format) : undefined,
      description: colDef.description ? String(colDef.description) : undefined,
    }));
    const primaryKey = required.includes('id') ? 'id' : (required[0] ?? columns[0]?.name ?? 'id');
    return { name, columns, primaryKey };
  });
}

export async function testSupabaseConnection(
  config: SupabaseConfig,
): Promise<{ success: boolean; tables?: SupabaseTable[]; error?: string }> {
  try {
    const base = normalizeUrl(config.url);
    const res = await fetch(`${base}/rest/v1/`, { headers: adminHeaders(config) });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${body}` };
    }
    const spec = (await res.json()) as Record<string, unknown>;
    const tables = parseTablesFromSpec(spec);
    return { success: true, tables };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}

export async function fetchTableData(
  config: SupabaseConfig,
  table: string,
  page: number,
  pageSize: number,
  sortColumn?: string,
  sortAsc?: boolean,
): Promise<{ data: SupabaseRow[]; count: number; error?: string }> {
  try {
    const base = normalizeUrl(config.url);
    const params = new URLSearchParams({
      select: '*',
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    if (sortColumn) {
      params.set('order', `${sortColumn}.${sortAsc !== false ? 'asc' : 'desc'}`);
    }
    const res = await fetch(`${base}/rest/v1/${table}?${params}`, {
      headers: adminHeaders(config, { Prefer: 'count=exact' }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { data: [], count: 0, error: `HTTP ${res.status}: ${body}` };
    }
    const contentRange = res.headers.get('Content-Range') ?? '';
    const match = contentRange.match(/\/(\d+)$/);
    const count = match ? parseInt(match[1], 10) : 0;
    const data = (await res.json()) as SupabaseRow[];
    return { data: Array.isArray(data) ? data : [], count };
  } catch (err) {
    return { data: [], count: 0, error: err instanceof Error ? err.message : 'Fetch failed' };
  }
}

export async function insertSupabaseRow(
  config: SupabaseConfig,
  table: string,
  row: SupabaseRow,
): Promise<{ data?: SupabaseRow; error?: string }> {
  try {
    const base = normalizeUrl(config.url);
    const res = await fetch(`${base}/rest/v1/${table}`, {
      method: 'POST',
      headers: adminHeaders(config, { Prefer: 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status}: ${body}` };
    }
    const result = (await res.json()) as SupabaseRow | SupabaseRow[];
    return { data: Array.isArray(result) ? result[0] : result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Insert failed' };
  }
}

export async function updateSupabaseRow(
  config: SupabaseConfig,
  table: string,
  primaryKey: string,
  id: unknown,
  updates: SupabaseRow,
): Promise<{ error?: string }> {
  try {
    const base = normalizeUrl(config.url);
    const res = await fetch(`${base}/rest/v1/${table}?${primaryKey}=eq.${id}`, {
      method: 'PATCH',
      headers: adminHeaders(config),
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status}: ${body}` };
    }
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' };
  }
}

export async function deleteSupabaseRow(
  config: SupabaseConfig,
  table: string,
  primaryKey: string,
  id: unknown,
): Promise<{ error?: string }> {
  try {
    const base = normalizeUrl(config.url);
    const res = await fetch(`${base}/rest/v1/${table}?${primaryKey}=eq.${id}`, {
      method: 'DELETE',
      headers: adminHeaders(config),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status}: ${body}` };
    }
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Delete failed' };
  }
}
