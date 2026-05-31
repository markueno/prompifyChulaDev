import { memo, useState, useCallback } from 'react';
import { classNames } from '~/utils/classNames';

const COLUMN_TYPES = ['text', 'integer', 'numeric', 'boolean', 'timestamptz', 'uuid', 'jsonb'] as const;
type ColumnType = (typeof COLUMN_TYPES)[number];

interface ColumnDef {
  id: number;
  name: string;
  type: ColumnType;
  nullable: boolean;
  defaultValue: string;
}

interface CreateTableModalProps {
  chatId: string;
  onClose: () => void;
  onCreated: (tableName: string) => void;
}

let colIdSeq = 0;

function makeCol(): ColumnDef {
  return { id: ++colIdSeq, name: '', type: 'text', nullable: true, defaultValue: '' };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^([^a-z])/, '_$1');
}

export const CreateTableModal = memo(({ chatId, onClose, onCreated }: CreateTableModalProps) => {
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ColumnDef[]>([makeCol()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addColumn = useCallback(() => setColumns(prev => [...prev, makeCol()]), []);

  const removeColumn = useCallback((id: number) => {
    setColumns(prev => prev.filter(c => c.id !== id));
  }, []);

  const updateColumn = useCallback((id: number, patch: Partial<ColumnDef>) => {
    setColumns(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    const name = slugify(tableName.trim());

    if (!name) {
      setError('Table name is required');
      return;
    }

    const validCols = columns.filter(c => c.name.trim());

    setSaving(true);

    try {
      const res = await fetch('/api/supabase/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          tableName: name,
          columns: validCols.map(c => ({
            name: slugify(c.name),
            type: c.type,
            nullable: c.nullable,
            defaultValue: c.defaultValue || undefined,
          })),
        }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string };

      if (!res.ok || data.error) {
        setError(data.error || 'Failed to create table');
        return;
      }

      onCreated(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }, [chatId, tableName, columns, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bolt-elements-borderColor px-5 py-4">
          <h2 className="text-base font-semibold text-bolt-elements-textPrimary">Create Table</h2>
          <button
            onClick={onClose}
            className="i-ph:x text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          />
        </div>

        {/* Body */}
        <div className="space-y-5 px-5 py-4">
          {/* Table name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-bolt-elements-textSecondary">Table name</label>
            <input
              type="text"
              value={tableName}
              onChange={e => setTableName(e.target.value)}
              placeholder="e.g. orders"
              className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
            {tableName && (
              <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                Will be saved as <code className="text-bolt-elements-textPrimary">{slugify(tableName)}</code>
              </p>
            )}
          </div>

          {/* Auto-added columns notice */}
          <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-xs text-bolt-elements-textSecondary">
            Auto-added: <code>id uuid PK</code>, <code>created_at</code>, <code>updated_at</code>
          </div>

          {/* Column list */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-bolt-elements-textSecondary">Columns</span>
              <button
                onClick={addColumn}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-1 hover:text-bolt-elements-textPrimary"
              >
                <span className="i-ph:plus text-sm" />
                Add column
              </button>
            </div>

            <div className="space-y-2">
              {columns.map(col => (
                <div key={col.id} className="flex items-center gap-2">
                  {/* Name */}
                  <input
                    type="text"
                    value={col.name}
                    onChange={e => updateColumn(col.id, { name: e.target.value })}
                    placeholder="column_name"
                    className="flex-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-xs text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus"
                  />

                  {/* Type */}
                  <select
                    value={col.type}
                    onChange={e => updateColumn(col.id, { type: e.target.value as ColumnType })}
                    className="w-28 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-xs text-bolt-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus"
                  >
                    {COLUMN_TYPES.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  {/* Nullable toggle */}
                  <label className="flex cursor-pointer items-center gap-1 text-xs text-bolt-elements-textSecondary">
                    <input
                      type="checkbox"
                      checked={col.nullable}
                      onChange={e => updateColumn(col.id, { nullable: e.target.checked })}
                      className="accent-bolt-elements-focus"
                    />
                    null
                  </label>

                  {/* Remove */}
                  <button
                    onClick={() => removeColumn(col.id)}
                    disabled={columns.length === 1}
                    className={classNames(
                      'i-ph:trash text-base',
                      columns.length === 1
                        ? 'cursor-not-allowed text-bolt-elements-textTertiary'
                        : 'text-bolt-elements-textSecondary hover:text-red-500'
                    )}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-bolt-elements-borderColor px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-1"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={classNames(
              'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
              saving ? 'cursor-not-allowed bg-blue-500/50' : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {saving ? 'Creating…' : 'Create Table'}
          </button>
        </div>
      </div>
    </div>
  );
});
