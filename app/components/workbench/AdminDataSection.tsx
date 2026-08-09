import { memo, useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { chatId } from '~/lib/persistence';
import { classNames } from '~/utils/classNames';
import type { SupabaseConfig, SupabaseTable, SupabaseRow, SupabaseColumn } from '~/types/supabase-admin';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  clearSupabaseConfig,
  testSupabaseConnection,
  fetchTableData,
  insertSupabaseRow,
  updateSupabaseRow,
  deleteSupabaseRow,
} from '~/lib/stores/supabase-admin';
import { CreateTableModal } from './CreateTableModal';
import { AddColumnModal } from './AddColumnModal';
import { ImportDataModal } from './ImportDataModal';
import {
  listProxyTables,
  fetchProxyRows,
  insertProxyRow,
  updateProxyRow,
  deleteProxyRow,
  dropProxyTable,
} from '~/lib/stores/data-proxy-client';

/** Supabase logo mark (green). Used as a logo-only affordance (no text). */
function SupabaseMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        fill="#3ECF8E"
        d="M13.4 1.2 3.1 11.5c-.9.9-.4 2.5 1 2.7l7.6 1.3-1.9 17.9c-.2 1.9 2.3 2.9 3.4 1.3L21 24c.6-.9 0-2.1-1-2.2l-7.2-1 1.8-18.4c.1-1.2-1.4-1.9-2.2-1.2z"
      />
    </svg>
  );
}

type Step = 'loading' | 'connect' | 'tables' | 'data';

const PAGE_SIZE = 50;

const NUMERIC_TYPES = new Set([
  'integer',
  'bigint',
  'smallint',
  'numeric',
  'real',
  'double precision',
  'float4',
  'float8',
  'int2',
  'int4',
  'int8',
]);

/*
 * DB-managed columns: id is the primary key (assigned by the proxy / gen_random_uuid),
 * created_at/updated_at are set automatically. They are hidden from the "add row" form and
 * read-only when editing — the row's own id is used for update/delete, not a form field.
 */
const AUTO_MANAGED = new Set(['id', 'created_at', 'updated_at']);

function inputTypeFor(col: SupabaseColumn): 'number' | 'checkbox' | 'date' | 'datetime-local' | 'textarea' | 'text' {
  if (NUMERIC_TYPES.has(col.type) || NUMERIC_TYPES.has(col.format ?? '')) {
    return 'number';
  }

  if (col.type === 'boolean') {
    return 'checkbox';
  }

  if (col.type === 'date') {
    return 'date';
  }

  if (col.type.includes('timestamp')) {
    return 'datetime-local';
  }

  if (col.type === 'json' || col.type === 'jsonb' || col.type === 'ARRAY') {
    return 'textarea';
  }

  return 'text';
}

function cellDisplay(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

// ── Connection form ──────────────────────────────────────────────────────────

interface ConnectFormProps {
  initial: SupabaseConfig;
  connecting: boolean;
  onSubmit: (cfg: SupabaseConfig) => void;
}

const ConnectForm = memo(({ initial, connecting, onSubmit }: ConnectFormProps) => {
  const [cfg, setCfg] = useState<SupabaseConfig>(initial);
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSubmit(cfg);
      }}
      className="max-w-md space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-1">Supabase URL</label>
        <input
          type="url"
          value={cfg.url}
          onChange={e => setCfg(c => ({ ...c, url: e.target.value }))}
          placeholder="https://your-project.supabase.co"
          required
          className="w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/50"
        />
        <p className="mt-1 text-xs text-bolt-elements-textTertiary">
          Self-hosted: http://your-server:8000 or https://supabase.yourdomain.com
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-1">Anon Key</label>
        <input
          type="password"
          value={cfg.anonKey}
          onChange={e => setCfg(c => ({ ...c, anonKey: e.target.value }))}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
          required
          className="w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/50"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-1">
          Service Role Key{' '}
          <span className="font-normal text-bolt-elements-textTertiary">(bypasses Row Level Security)</span>
        </label>
        <input
          type="password"
          value={cfg.serviceRoleKey}
          onChange={e => setCfg(c => ({ ...c, serviceRoleKey: e.target.value }))}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
          className="w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/50"
        />
        <p className="mt-1 text-xs text-bolt-elements-textTertiary">
          Found in Supabase → Project Settings → API → service_role secret.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-1">
          Project Name <span className="font-normal text-bolt-elements-textTertiary">(optional label)</span>
        </label>
        <input
          type="text"
          value={cfg.projectName ?? ''}
          onChange={e => setCfg(c => ({ ...c, projectName: e.target.value }))}
          placeholder="My App"
          className="w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/50"
        />
      </div>

      <button
        type="submit"
        disabled={connecting || !cfg.url || !cfg.anonKey}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
      >
        {connecting ? (
          <>
            <div className="i-ph:circle-notch animate-spin w-4 h-4" />
            Connecting…
          </>
        ) : (
          <>
            <div className="i-ph:plug-charging w-4 h-4" />
            Connect to Supabase
          </>
        )}
      </button>
    </form>
  );
});
ConnectForm.displayName = 'ConnectForm';

// ── Row add / edit modal ─────────────────────────────────────────────────────

interface RowModalProps {
  mode: 'add' | 'edit';
  table: SupabaseTable;
  values: Record<string, string>;
  saving: boolean;
  onChange: (name: string, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const RowModal = memo(({ mode, table, values, saving, onChange, onSubmit, onClose }: RowModalProps) => {
  const visibleCols = mode === 'add' ? table.columns.filter(c => !AUTO_MANAGED.has(c.name)) : table.columns;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-bolt-elements-background-depth-2 rounded-xl shadow-xl border border-bolt-elements-borderColor w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bolt-elements-borderColor">
          <h3 className="font-semibold text-bolt-elements-textPrimary">{mode === 'add' ? 'Add Row' : 'Edit Row'}</h3>
          <button
            onClick={() => !saving && onClose()}
            className="p-1 rounded hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary"
          >
            <div className="i-ph:x w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          {visibleCols.map(col => {
            const itype = inputTypeFor(col);
            const readonly = mode === 'edit' && AUTO_MANAGED.has(col.name);

            return (
              <div key={col.name}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-bolt-elements-textSecondary mb-1">
                  {col.name}
                  <span className="text-bolt-elements-textTertiary font-normal">{col.format ?? col.type}</span>
                </label>

                {itype === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={values[col.name] === 'true'}
                    onChange={e => onChange(col.name, String(e.target.checked))}
                    disabled={readonly}
                    className="w-4 h-4 rounded border-bolt-elements-borderColor accent-accent-500"
                  />
                ) : itype === 'textarea' ? (
                  <textarea
                    value={values[col.name] ?? ''}
                    onChange={e => onChange(col.name, e.target.value)}
                    readOnly={readonly}
                    rows={3}
                    placeholder="{}"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary font-mono focus:outline-none focus:ring-1 focus:ring-accent-500/50 read-only:opacity-50"
                  />
                ) : (
                  <input
                    type={itype}
                    value={values[col.name] ?? ''}
                    onChange={e => onChange(col.name, e.target.value)}
                    readOnly={readonly}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-accent-500/50 read-only:opacity-50 read-only:cursor-default"
                  />
                )}
              </div>
            );
          })}

          <div className="flex justify-end gap-2 pt-2 border-t border-bolt-elements-borderColor">
            <button
              type="button"
              onClick={() => !saving && onClose()}
              className="px-3 py-1.5 text-sm rounded-lg hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : mode === 'add' ? 'Add Row' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});
RowModal.displayName = 'RowModal';

// ── Main section ─────────────────────────────────────────────────────────────

export const AdminDataSection = memo(() => {
  const currentChatId = useStore(chatId);

  const [step, setStep] = useState<Step>('loading');
  const [platformMode, setPlatformMode] = useState(false);
  const [savedConfig, setSavedConfig] = useState<SupabaseConfig | null>(null);
  const [tables, setTables] = useState<SupabaseTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<SupabaseTable | null>(null);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showImportData, setShowImportData] = useState(false);

  const [rows, setRows] = useState<SupabaseRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | undefined>();
  const [sortAsc, setSortAsc] = useState(true);

  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [rowModalMode, setRowModalMode] = useState<'add' | 'edit' | null>(null);
  const [editingRow, setEditingRow] = useState<SupabaseRow | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SupabaseRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Schema editing (platform data proxy only — a custom Supabase has no DDL endpoint here).
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [dropTableTarget, setDropTableTarget] = useState<SupabaseTable | null>(null);
  const [dropTableConfirm, setDropTableConfirm] = useState('');
  const [droppingTable, setDroppingTable] = useState(false);

  /*
   * On mount: 1) check if platform has Supabase configured (server),
   *           2) fall back to user-saved config (localStorage),
   *           3) show manual connect form.
   */
  useEffect(() => {
    if (!currentChatId) {
      setStep('connect');
      return;
    }

    const run = async () => {
      /*
       * ── Priority 0: self-hosted data proxy (no Supabase). This is the default
       *    platform path now that Supabase is dropped. ALWAYS use it — even on a
       *    fresh chat with zero tables — so the Import Data button is reachable
       *    (the empty state renders it). Falls through only if the proxy is
       *    unreachable, so a user can still connect a custom Supabase manually.
       */
      try {
        const proxyTables = await listProxyTables(currentChatId);

        setSavedConfig(null);
        setPlatformMode(true);
        setTables(proxyTables);
        setStep('tables');

        return;
      } catch {
        // proxy unreachable — fall through to Supabase/localStorage paths
      }

      // ── Priority 1: server-configured platform Supabase ─────────────────
      try {
        const res = await fetch(`/api/supabase/config?chatId=${encodeURIComponent(currentChatId)}`);

        if (res.ok) {
          const data = (await res.json()) as {
            configured: boolean;
            url?: string;
            anonKey?: string;
            schema?: string;
          };

          if (data.configured && data.url && data.anonKey) {
            const cfg: SupabaseConfig = {
              url: data.url,
              anonKey: data.anonKey,
              serviceRoleKey: '', // service key stays server-side
              projectName: data.schema,
            };
            setConnecting(true);

            const result = await testSupabaseConnection(cfg);
            setConnecting(false);

            if (result.success && result.tables) {
              setSavedConfig(cfg);
              setTables(result.tables);
              setPlatformMode(true);
              setStep('tables');

              return;
            }
          }
        }
      } catch {
        // server not reachable — fall through to localStorage
      }

      // ── Priority 2: user-saved config in localStorage ────────────────────
      const saved = getSupabaseConfig(currentChatId);

      if (saved) {
        setSavedConfig(saved);
        setConnecting(true);

        const result = await testSupabaseConnection(saved);
        setConnecting(false);

        if (result.success && result.tables) {
          setTables(result.tables);
          setStep('tables');

          return;
        }
      }

      // ── Priority 3: show manual connect form ─────────────────────────────
      setStep('connect');
    };

    run();
  }, [currentChatId]);

  const handleConnect = async (cfg: SupabaseConfig) => {
    setConnecting(true);

    const result = await testSupabaseConnection(cfg);
    setConnecting(false);

    if (result.success && result.tables) {
      setSavedConfig(cfg);
      setTables(result.tables);

      if (currentChatId) {
        saveSupabaseConfig(currentChatId, cfg);
      }

      setStep('tables');
      toast.success(`Connected — ${result.tables.length} table${result.tables.length !== 1 ? 's' : ''} found`);
    } else {
      toast.error(result.error ?? 'Connection failed');
    }
  };

  /*
   * Navigate to the connect form WITHOUT tearing down the current connection — the teardown used
   * to happen here, which left the user stranded on a form with nothing to go back to. The actual
   * disconnect now happens only on an explicit action (below) or when a new config is submitted.
   */
  const handleShowConnectForm = () => {
    setStep('connect');
  };

  const handleDisconnect = () => {
    if (!platformMode && currentChatId) {
      clearSupabaseConfig(currentChatId);
    }

    setSavedConfig(null);
    setPlatformMode(false);
    setTables([]);
    setSelectedTable(null);
    setRows([]);
    setStep('connect');
  };

  /** Is there a live connection to return to from the connect form? */
  const hasConnection = platformMode || savedConfig !== null;

  const refreshTables = useCallback(async () => {
    if (platformMode && currentChatId) {
      const proxyTables = await listProxyTables(currentChatId);
      setTables(proxyTables);
    } else if (savedConfig) {
      const result = await testSupabaseConnection(savedConfig);

      if (result.success && result.tables) {
        setTables(result.tables);
      }
    }
  }, [platformMode, currentChatId, savedConfig]);

  const handleTableCreated = useCallback(
    async (tableName: string) => {
      setShowCreateTable(false);
      toast.success(`Table "${tableName}" created`);
      await refreshTables();
    },
    [refreshTables]
  );

  const handleImported = useCallback(
    async (tableName: string) => {
      setShowImportData(false);
      toast.success(`Imported "${tableName}"`);
      await refreshTables();
    },
    [refreshTables]
  );

  const handleDropTable = useCallback(async () => {
    if (!dropTableTarget || !currentChatId) {
      return;
    }

    setDroppingTable(true);

    const result = await dropProxyTable(currentChatId, dropTableTarget.name);
    setDroppingTable(false);

    if (!result.success) {
      toast.error(result.error || 'Failed to delete table');
      return;
    }

    toast.success(`Table "${dropTableTarget.name}" deleted`);

    // If the open table was the one dropped, fall back to the grid.
    if (selectedTable?.name === dropTableTarget.name) {
      setSelectedTable(null);
      setRows([]);
      setStep('tables');
    }

    setDropTableTarget(null);
    setDropTableConfirm('');
    await refreshTables();
  }, [dropTableTarget, currentChatId, selectedTable, refreshTables]);

  const doLoadData = useCallback(
    async (table: SupabaseTable, pg: number, sc?: string, sa?: boolean) => {
      if (platformMode && currentChatId) {
        setLoading(true);

        const result = await fetchProxyRows(currentChatId, table.name, pg, PAGE_SIZE, sc, sa);
        setLoading(false);

        if (result.error) {
          toast.error(result.error);
        } else {
          setRows(result.data);
          setTotalRows(result.count);
        }

        return;
      }

      if (!savedConfig) {
        return;
      }

      setLoading(true);

      const result = await fetchTableData(savedConfig, table.name, pg, PAGE_SIZE, sc, sa);
      setLoading(false);

      if (result.error) {
        toast.error(result.error);
      } else {
        setRows(result.data);
        setTotalRows(result.count);
      }
    },
    [platformMode, currentChatId, savedConfig]
  );

  const handleSelectTable = (table: SupabaseTable) => {
    setSelectedTable(table);
    setPage(0);
    setSortColumn(undefined);
    setSortAsc(true);
    setStep('data');
    doLoadData(table, 0, undefined, true);
  };

  const handleColumnAdded = useCallback(
    async (columnName: string) => {
      setShowAddColumn(false);
      toast.success(`Column "${columnName}" added`);

      if (!platformMode || !currentChatId || !selectedTable) {
        return;
      }

      /*
       * refreshTables() only repopulates the grid — the open table is a separate copy, so re-sync
       * it from the fresh list or the new column won't appear until you navigate away and back.
       */
      const proxyTables = await listProxyTables(currentChatId);
      setTables(proxyTables);

      const updated = proxyTables.find(t => t.name === selectedTable.name);

      if (updated) {
        setSelectedTable(updated);
        await doLoadData(updated, page, sortColumn, sortAsc);
      }
    },
    [platformMode, currentChatId, selectedTable, page, sortColumn, sortAsc, doLoadData]
  );

  const handleSort = (colName: string) => {
    const newAsc = sortColumn === colName ? !sortAsc : true;
    setSortColumn(colName);
    setSortAsc(newAsc);

    if (selectedTable) {
      doLoadData(selectedTable, page, colName, newAsc);
    }
  };

  const handlePage = (next: number) => {
    setPage(next);

    if (selectedTable) {
      doLoadData(selectedTable, next, sortColumn, sortAsc);
    }
  };

  const openAddModal = () => {
    if (!selectedTable) {
      return;
    }

    const init: Record<string, string> = {};
    selectedTable.columns
      .filter(c => !AUTO_MANAGED.has(c.name))
      .forEach(c => {
        init[c.name] = '';
      });
    setFormValues(init);
    setEditingRow(null);
    setRowModalMode('add');
  };

  const openEditModal = (row: SupabaseRow) => {
    if (!selectedTable) {
      return;
    }

    const vals: Record<string, string> = {};
    selectedTable.columns.forEach(c => {
      vals[c.name] = cellDisplay(row[c.name]);
    });
    setFormValues(vals);
    setEditingRow(row);
    setRowModalMode('edit');
  };

  const handleSaveRow = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTable || (!savedConfig && !(platformMode && currentChatId))) {
      return;
    }

    setSaving(true);

    const payload: SupabaseRow = {};
    const targetCols = selectedTable.columns.filter(c => !AUTO_MANAGED.has(c.name));

    for (const col of targetCols) {
      const raw = formValues[col.name];

      if (raw === '' || raw === undefined) {
        payload[col.name] = null;
        continue;
      }

      const itype = inputTypeFor(col);

      if (itype === 'number') {
        payload[col.name] = Number(raw);
      } else if (itype === 'checkbox') {
        payload[col.name] = raw === 'true';
      } else if (col.type === 'json' || col.type === 'jsonb') {
        try {
          payload[col.name] = JSON.parse(raw);
        } catch {
          payload[col.name] = raw;
        }
      } else {
        payload[col.name] = raw;
      }
    }

    let error: string | undefined;

    if (platformMode && currentChatId) {
      if (rowModalMode === 'add') {
        const res = await insertProxyRow(currentChatId, selectedTable.name, payload);
        error = res.error;
      } else if (editingRow) {
        const pkVal = String(editingRow[selectedTable.primaryKey]);
        const res = await updateProxyRow(currentChatId, selectedTable.name, pkVal, payload);
        error = res.error;
      }
    } else if (savedConfig) {
      if (rowModalMode === 'add') {
        const res = await insertSupabaseRow(savedConfig, selectedTable.name, payload);
        error = res.error;
      } else if (editingRow) {
        const pkVal = editingRow[selectedTable.primaryKey];
        const res = await updateSupabaseRow(savedConfig, selectedTable.name, selectedTable.primaryKey, pkVal, payload);
        error = res.error;
      }
    }

    setSaving(false);

    if (error) {
      toast.error(error);
    } else {
      toast.success(rowModalMode === 'add' ? 'Row added' : 'Row updated');
      setRowModalMode(null);
      doLoadData(selectedTable, page, sortColumn, sortAsc);
    }
  };

  const handleDelete = async () => {
    if (!selectedTable || !deleteTarget || (!savedConfig && !(platformMode && currentChatId))) {
      return;
    }

    setDeleting(true);

    let error: string | undefined;

    if (platformMode && currentChatId) {
      const pkVal = String(deleteTarget[selectedTable.primaryKey]);
      const res = await deleteProxyRow(currentChatId, selectedTable.name, pkVal);
      error = res.error;
    } else if (savedConfig) {
      const res = await deleteSupabaseRow(
        savedConfig,
        selectedTable.name,
        selectedTable.primaryKey,
        deleteTarget[selectedTable.primaryKey]
      );
      error = res.error;
    }

    setDeleting(false);

    if (error) {
      toast.error(error);
    } else {
      toast.success('Row deleted');
      setDeleteTarget(null);
      doLoadData(selectedTable, page, sortColumn, sortAsc);
    }
  };

  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  // ── Loading step (checking server config) ─────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="flex items-center gap-3 py-8 text-bolt-elements-textTertiary">
        <div className="i-ph:circle-notch animate-spin w-5 h-5" />
        <span className="text-sm">Connecting to database…</span>
      </div>
    );
  }

  // ── Connect step (manual form — fallback when platform has no Supabase) ───
  if (step === 'connect') {
    const initial: SupabaseConfig = savedConfig ?? { url: '', anonKey: '', serviceRoleKey: '' };
    return (
      <>
        {/* Breadcrumb — mirrors the data step's, so this is no longer the one dead-end screen. */}
        {hasConnection && (
          <div className="flex items-center justify-between gap-2 -mx-6 -mt-6 mb-6 px-6 py-3 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-1">
            <button
              onClick={() => setStep('tables')}
              className="flex items-center gap-1 text-sm text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
            >
              <div className="i-ph:caret-left w-4 h-4" />
              Back to tables
            </button>
            {savedConfig && (
              <button
                onClick={handleDisconnect}
                className="text-xs px-2 py-1 rounded text-bolt-elements-textTertiary hover:text-red-500 hover:bg-bolt-elements-background-depth-2 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        )}
        {connecting && (
          <p className="flex items-center gap-2 mb-4 text-sm text-bolt-elements-textTertiary">
            <span className="i-ph:circle-notch animate-spin w-4 h-4" />
            Reconnecting to saved instance…
          </p>
        )}
        <ConnectForm initial={initial} connecting={connecting} onSubmit={handleConnect} />
      </>
    );
  }

  // ── Tables grid step ───────────────────────────────────────────────────────
  if (step === 'tables') {
    return (
      <div>
        {/* Connection bar — vertical so the action buttons never overlap on a narrow panel */}
        <div className="flex flex-col gap-3 mb-6 px-3 py-3 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor">
          {/* Status row */}
          <div className="flex items-center justify-between min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              {platformMode ? (
                <>
                  <span className="text-sm text-bolt-elements-textSecondary">Platform database</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-accent-500/15 text-accent-500 font-medium shrink-0">
                    auto
                  </span>
                </>
              ) : (
                <span className="text-sm text-bolt-elements-textSecondary truncate">
                  {savedConfig?.projectName || savedConfig?.url}
                </span>
              )}
            </div>
            <span className="text-xs text-bolt-elements-textTertiary shrink-0">
              {tables.length} table{tables.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Actions — stacked, full-width, separate */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setShowImportData(true)}
              className="flex items-center justify-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition-colors font-medium w-full"
            >
              <span className="i-ph:upload-simple text-sm" />
              Import Data
            </button>
            <button
              onClick={() => setShowCreateTable(true)}
              className="flex items-center justify-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition-colors font-medium w-full"
            >
              <span className="i-ph:plus text-sm" />
              New Table
            </button>
            {/* Labelled — an unlabelled icon that silently tore down the connection is how
                people ended up stranded on the connect form. */}
            <button
              onClick={handleShowConnectForm}
              className="flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2 transition-colors w-full"
              title="Connect your own Supabase instance instead"
            >
              <SupabaseMark className="w-4 h-4" />
              Use my own Supabase
            </button>
          </div>
        </div>

        {tables.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bolt-elements-borderColor p-12 text-center">
            <div className="i-ph:database text-4xl text-bolt-elements-textTertiary mx-auto mb-3" />
            <p className="text-sm text-bolt-elements-textTertiary mb-4">No tables yet.</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setShowImportData(true)}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition-colors font-medium"
              >
                <span className="i-ph:upload-simple" />
                Import data
              </button>
              <button
                onClick={() => setShowCreateTable(true)}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
              >
                <span className="i-ph:plus" />
                Create a table
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tables.map(t => (
              <div
                key={t.name}
                className="relative rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 hover:border-accent-500/50 hover:bg-bolt-elements-background-depth-2 transition-all group"
              >
                <button onClick={() => handleSelectTable(t)} className="w-full text-left p-4">
                  <div className="flex items-center gap-2 mb-2 pr-6">
                    <div className="i-ph:table w-4 h-4 text-bolt-elements-textTertiary group-hover:text-accent-500 transition-colors" />
                    <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">{t.name}</span>
                  </div>
                  <p className="text-xs text-bolt-elements-textTertiary">
                    {t.columns.length} col{t.columns.length !== 1 ? 's' : ''}
                    {' · '}
                    pk: {t.primaryKey}
                  </p>
                </button>
                {platformMode && (
                  <button
                    onClick={() => {
                      setDropTableTarget(t);
                      setDropTableConfirm('');
                    }}
                    title={`Delete table "${t.name}"`}
                    aria-label={`Delete table ${t.name}`}
                    className="absolute right-2 top-2 p-1 rounded text-bolt-elements-textTertiary opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-500 hover:bg-bolt-elements-background-depth-3 transition-all"
                  >
                    <div className="i-ph:trash w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {showCreateTable && currentChatId && (
          <CreateTableModal
            chatId={currentChatId}
            onClose={() => setShowCreateTable(false)}
            onCreated={handleTableCreated}
          />
        )}

        {showImportData && currentChatId && (
          <ImportDataModal
            chatId={currentChatId}
            onClose={() => setShowImportData(false)}
            onImported={handleImported}
          />
        )}

        {/* Drop table — type-to-confirm, because this destroys every row in it. */}
        {dropTableTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => !droppingTable && setDropTableTarget(null)}
          >
            <div
              className="bg-bolt-elements-background-depth-2 rounded-xl shadow-xl border border-bolt-elements-borderColor p-6 w-full max-w-md"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="font-semibold text-bolt-elements-textPrimary mb-2">Delete table</h3>
              <p className="text-sm text-bolt-elements-textSecondary mb-3">
                This permanently deletes <span className="font-mono">{dropTableTarget.name}</span> and every row in it.
                This cannot be undone.
              </p>
              <label className="mb-1 block text-xs font-medium text-bolt-elements-textSecondary">
                Type <span className="font-mono text-bolt-elements-textPrimary">{dropTableTarget.name}</span> to confirm
              </label>
              <input
                type="text"
                value={dropTableConfirm}
                autoFocus
                onChange={e => setDropTableConfirm(e.target.value)}
                className="w-full mb-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => !droppingTable && setDropTableTarget(null)}
                  className="px-3 py-1.5 text-sm rounded-lg hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDropTable}
                  disabled={droppingTable || dropTableConfirm !== dropTableTarget.name}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg bg-red-500/20 text-red-500 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {droppingTable ? 'Deleting…' : 'Delete table'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Data table step ────────────────────────────────────────────────────────
  if (!selectedTable) {
    return null;
  }

  /*
   * Columns a user can actually type into. id/created_at/updated_at are set by the DB and hidden
   * from the row form, so a table with only those has nothing to insert.
   */
  const insertableColumnCount = selectedTable.columns.filter(c => !AUTO_MANAGED.has(c.name)).length;

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between -mx-6 -mt-6 mb-0 px-6 py-3 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-1">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            onClick={() => {
              setStep('tables');
              setSelectedTable(null);
            }}
            className="flex items-center gap-1 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
          >
            <div className="i-ph:caret-left w-4 h-4" />
            Tables
          </button>
          <div className="i-ph:caret-right w-3 h-3 text-bolt-elements-textTertiary" />
          <span className="font-medium text-bolt-elements-textPrimary">{selectedTable.name}</span>
          {!loading && (
            <span className="text-xs text-bolt-elements-textTertiary ml-1">{totalRows.toLocaleString()} rows</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => doLoadData(selectedTable, page, sortColumn, sortAsc)}
            disabled={loading}
            title="Refresh"
            className="p-1.5 rounded-lg hover:bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary disabled:opacity-40 transition-colors"
          >
            <div className={classNames('i-ph:arrow-clockwise w-4 h-4', loading ? 'animate-spin' : '')} />
          </button>
          {platformMode && (
            <button
              onClick={() => setShowAddColumn(true)}
              title="Add a column to this table"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 transition-colors"
            >
              <div className="i-ph:columns-plus-left w-4 h-4" />
              Add Column
            </button>
          )}
          <button
            onClick={openAddModal}
            disabled={insertableColumnCount === 0}
            title={insertableColumnCount === 0 ? 'This table has no columns to fill in yet' : 'Add a row'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <div className="i-ph:plus w-4 h-4" />
            Add Row
          </button>
        </div>
      </div>

      {/*
       * A table can still exist with no user columns (created before the guard, or by the AI).
       * Say what to do about it instead of letting Add Row dead-end on "No valid columns".
       */}
      {insertableColumnCount === 0 && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-bolt-elements-borderColor p-6 text-center">
          <div className="i-ph:columns text-2xl text-bolt-elements-textTertiary" />
          <p className="text-sm text-bolt-elements-textTertiary">
            This table has no columns yet, so it can&apos;t hold rows.
          </p>
          {platformMode && (
            <button
              onClick={() => setShowAddColumn(true)}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition-colors font-medium"
            >
              <span className="i-ph:plus" />
              Add a column
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="-mx-6 overflow-auto mt-0" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-bolt-elements-textTertiary gap-2">
            <div className="i-ph:circle-notch animate-spin text-xl" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-bolt-elements-textTertiary">
            <div className="i-ph:rows text-3xl" />
            <p className="text-sm">No rows yet. Add one to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-bolt-elements-background-depth-1 border-b border-bolt-elements-borderColor">
                {selectedTable.columns.map(col => (
                  <th
                    key={col.name}
                    className="text-left px-4 py-2.5 font-medium text-bolt-elements-textSecondary whitespace-nowrap cursor-pointer select-none hover:text-bolt-elements-textPrimary"
                    onClick={() => handleSort(col.name)}
                  >
                    <span className="flex items-center gap-1">
                      {col.name}
                      <span className="text-[10px] text-bolt-elements-textTertiary font-normal">
                        {col.format ?? col.type}
                      </span>
                      {sortColumn === col.name && (
                        <div className={classNames('w-3 h-3', sortAsc ? 'i-ph:arrow-up' : 'i-ph:arrow-down')} />
                      )}
                    </span>
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-bolt-elements-borderColor last:border-0 hover:bg-bolt-elements-background-depth-1/60 group cursor-pointer"
                  onClick={() => openEditModal(row)}
                >
                  {selectedTable.columns.map(col => (
                    <td key={col.name} className="px-4 py-2.5 text-bolt-elements-textPrimary max-w-[220px]">
                      <span className="block truncate text-sm">{cellDisplay(row[col.name])}</span>
                    </td>
                  ))}
                  <td className="px-3 py-2.5">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setDeleteTarget(row);
                      }}
                      title="Delete row"
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-bolt-elements-textTertiary hover:text-red-500 transition-all"
                    >
                      <div className="i-ph:trash w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between -mx-6 px-6 py-2.5 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 mt-0">
          <span className="text-xs text-bolt-elements-textTertiary">
            {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, totalRows).toLocaleString()} of{' '}
            {totalRows.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page === 0 || loading}
              className="p-1.5 rounded hover:bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary disabled:opacity-40"
            >
              <div className="i-ph:caret-left w-4 h-4" />
            </button>
            <span className="text-xs text-bolt-elements-textSecondary px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages - 1 || loading}
              className="p-1.5 rounded hover:bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary disabled:opacity-40"
            >
              <div className="i-ph:caret-right w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {rowModalMode && (
        <RowModal
          mode={rowModalMode}
          table={selectedTable}
          values={formValues}
          saving={saving}
          onChange={(name, value) => setFormValues(v => ({ ...v, [name]: value }))}
          onSubmit={handleSaveRow}
          onClose={() => setRowModalMode(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="bg-bolt-elements-background-depth-2 rounded-xl shadow-xl border border-bolt-elements-borderColor p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-semibold text-bolt-elements-textPrimary mb-2">Delete Row</h3>
            <p className="text-sm text-bolt-elements-textSecondary mb-3">
              This action is permanent and cannot be undone.
            </p>
            <div className="px-3 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor mb-4 text-xs font-mono text-bolt-elements-textTertiary">
              {selectedTable.primaryKey}: {cellDisplay(deleteTarget[selectedTable.primaryKey])}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => !deleting && setDeleteTarget(null)}
                className="px-3 py-1.5 text-sm rounded-lg hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-1.5 text-sm font-medium rounded-lg bg-red-500/20 text-red-500 hover:bg-red-500/30 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete Row'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddColumn && currentChatId && (
        <AddColumnModal
          chatId={currentChatId}
          tableName={selectedTable.name}
          hasRows={totalRows > 0}
          onClose={() => setShowAddColumn(false)}
          onAdded={handleColumnAdded}
        />
      )}
    </>
  );
});

AdminDataSection.displayName = 'AdminDataSection';
