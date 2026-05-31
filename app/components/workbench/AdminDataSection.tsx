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

function isAutoColumn(col: SupabaseColumn): boolean {
  if (col.name === 'id' && (NUMERIC_TYPES.has(col.type) || col.format === 'bigint' || col.format === 'integer')) {
    return true;
  }

  if ((col.name === 'created_at' || col.name === 'updated_at') && col.type.includes('timestamp')) {
    return true;
  }

  return false;
}

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
  const visibleCols: SupabaseColumn[] = mode === 'add' ? table.columns.filter(c => !isAutoColumn(c)) : table.columns;

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
            const readonly = mode === 'edit' && isAutoColumn(col);
            const itype = inputTypeFor(col);

            return (
              <div key={col.name}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-bolt-elements-textSecondary mb-1">
                  {col.name}
                  <span className="text-bolt-elements-textTertiary font-normal">{col.format ?? col.type}</span>
                  {isAutoColumn(col) && <span className="text-bolt-elements-textTertiary italic">auto</span>}
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

  const handleTableCreated = useCallback(
    async (tableName: string) => {
      setShowCreateTable(false);
      toast.success(`Table "${tableName}" created`);

      if (savedConfig) {
        const result = await testSupabaseConnection(savedConfig);

        if (result.success && result.tables) {
          setTables(result.tables);
        }
      }
    },
    [savedConfig]
  );

  const doLoadData = useCallback(
    async (table: SupabaseTable, pg: number, sc?: string, sa?: boolean) => {
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
    [savedConfig]
  );

  const handleSelectTable = (table: SupabaseTable) => {
    setSelectedTable(table);
    setPage(0);
    setSortColumn(undefined);
    setSortAsc(true);
    setStep('data');
    doLoadData(table, 0, undefined, true);
  };

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
      .filter(c => !isAutoColumn(c))
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

    if (!savedConfig || !selectedTable) {
      return;
    }

    setSaving(true);

    const payload: SupabaseRow = {};
    const targetCols =
      rowModalMode === 'add'
        ? selectedTable.columns.filter(c => !isAutoColumn(c))
        : selectedTable.columns.filter(c => !isAutoColumn(c));

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

    if (rowModalMode === 'add') {
      const res = await insertSupabaseRow(savedConfig, selectedTable.name, payload);
      error = res.error;
    } else if (editingRow) {
      const pkVal = editingRow[selectedTable.primaryKey];
      const res = await updateSupabaseRow(savedConfig, selectedTable.name, selectedTable.primaryKey, pkVal, payload);
      error = res.error;
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
    if (!savedConfig || !selectedTable || !deleteTarget) {
      return;
    }

    setDeleting(true);

    const res = await deleteSupabaseRow(
      savedConfig,
      selectedTable.name,
      selectedTable.primaryKey,
      deleteTarget[selectedTable.primaryKey]
    );
    setDeleting(false);

    if (res.error) {
      toast.error(res.error);
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
        {/* Connection bar */}
        <div className="flex items-center justify-between mb-6 px-3 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor">
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
            <span className="text-xs text-bolt-elements-textTertiary shrink-0">
              {tables.length} table{tables.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              onClick={() => setShowCreateTable(true)}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition-colors font-medium"
            >
              <span className="i-ph:plus text-sm" />
              New Table
            </button>
            <button
              onClick={handleDisconnect}
              className="text-xs px-2 py-1 rounded text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2 transition-colors"
              title={platformMode ? 'Connect to your own Supabase instead' : 'Disconnect'}
            >
              {platformMode ? 'Use custom Supabase' : 'Disconnect'}
            </button>
          </div>
        </div>

        {tables.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bolt-elements-borderColor p-12 text-center">
            <div className="i-ph:database text-4xl text-bolt-elements-textTertiary mx-auto mb-3" />
            <p className="text-sm text-bolt-elements-textTertiary mb-4">No tables yet.</p>
            <button
              onClick={() => setShowCreateTable(true)}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition-colors font-medium"
            >
              <span className="i-ph:plus" />
              Create your first table
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tables.map(t => (
              <button
                key={t.name}
                onClick={() => handleSelectTable(t)}
                className="text-left p-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 hover:border-accent-500/50 hover:bg-bolt-elements-background-depth-2 transition-all group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="i-ph:table w-4 h-4 text-bolt-elements-textTertiary group-hover:text-accent-500 transition-colors" />
                  <span className="text-sm font-medium text-bolt-elements-textPrimary truncate">{t.name}</span>
                </div>
                <p className="text-xs text-bolt-elements-textTertiary">
                  {t.columns.length} col{t.columns.length !== 1 ? 's' : ''}
                  {' · '}
                  pk: {t.primaryKey}
                </p>
              </button>
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
      </div>
    );
  }

  // ── Data table step ────────────────────────────────────────────────────────
  if (!selectedTable) {
    return null;
  }

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
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors"
          >
            <div className="i-ph:plus w-4 h-4" />
            Add Row
          </button>
        </div>
      </div>

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
    </>
  );
});

AdminDataSection.displayName = 'AdminDataSection';
