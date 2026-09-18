export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  projectName?: string;
}

export interface SupabaseColumn {
  name: string;
  type: string;
  format?: string;
  nullable?: boolean;
  description?: string;
  references?: { table: string; column: string };
}

export interface SupabaseTable {
  name: string;
  columns: SupabaseColumn[];
  primaryKey: string;
  category?: string | null;
}

export type SupabaseRow = Record<string, unknown>;
