/**
 * Add a column to an existing table (PATCH /api/data/:chatId/schema).
 *
 * Mirrors CreateTableModal's column editor, but for one column at a time on a live table — the
 * missing half of the schema UI, which previously only let you define columns at create time.
 */
import { memo, useState, useCallback } from 'react';
import { classNames } from '~/utils/classNames';
import { useCloseOnEscape } from '~/lib/hooks/useCloseOnEscape';
import { alterProxyTable } from '~/lib/stores/data-proxy-client';

const COLUMN_TYPES = ['text', 'integer', 'numeric', 'boolean', 'timestamptz', 'uuid', 'jsonb'] as const;
type ColumnType = (typeof COLUMN_TYPES)[number];

interface AddColumnModalProps {
  chatId: string;
  tableName: string;
  /** True when the table already holds rows — a required column then needs a default. */
  hasRows: boolean;
  onClose: () => void;
  onAdded: (columnName: string) => void;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^([^a-z])/, '_$1');
}

export const AddColumnModal = memo(({ chatId, tableName, hasRows, onClose, onAdded }: AddColumnModalProps) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [nullable, setNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);

    const columnName = slugify(name.trim());

    if (!columnName) {
      setError('Column name is required');
      return;
    }

    if (!nullable && !defaultValue.trim() && hasRows) {
      setError('A required column needs a default value, because the table already has rows');
      return;
    }

    setSaving(true);

    const result = await alterProxyTable(chatId, tableName, {
      addColumns: [
        {
          name: columnName,
          type,
          nullable,
          defaultValue: defaultValue.trim() || undefined,
        },
      ],
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error || 'Failed to add column');
      return;
    }

    onAdded(columnName);
  }, [chatId, tableName, name, type, nullable, defaultValue, hasRows, onAdded]);

  // Escape always works, even when the panel is taller than the window.
  useCloseOnEscape(onClose, !saving);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !saving && onClose()}
    >
      {/*
       * flex column + a viewport-bounded max-height so a wide dataset (many columns) can't
       * grow the panel past the screen. Only the body scrolls, which keeps the close button
       * and the action buttons reachable — previously the panel just overflowed and the
       * header scrolled out of reach with no way to dismiss it.
       */}
      <div
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-bolt-elements-borderColor px-5 py-4">
          <h2 className="text-base font-semibold text-bolt-elements-textPrimary">
            Add column to <span className="font-mono">{tableName}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="i-ph:x text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-bolt-elements-textSecondary">Column name</label>
            <input
              type="text"
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
              placeholder="e.g. status"
              className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
            {name && slugify(name) !== name && (
              <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                Will be saved as <code className="text-bolt-elements-textPrimary">{slugify(name)}</code>
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-bolt-elements-textSecondary">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as ColumnType)}
                className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus"
              >
                {COLUMN_TYPES.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <label className="mt-5 flex cursor-pointer items-center gap-1.5 text-xs text-bolt-elements-textSecondary">
              <input type="checkbox" checked={nullable} onChange={e => setNullable(e.target.checked)} />
              Allow empty
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-bolt-elements-textSecondary">
              Default value <span className="font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={defaultValue}
              onChange={e => setDefaultValue(e.target.value)}
              placeholder="leave blank for none"
              className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
            {!nullable && hasRows && (
              <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                Existing rows need a value, so a required column must have a default.
              </p>
            )}
          </div>

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-bolt-elements-borderColor px-5 py-4">
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
              saving ? 'cursor-not-allowed bg-accent-500/50' : 'bg-accent-500 hover:bg-accent-600'
            )}
          >
            {saving ? 'Adding…' : 'Add column'}
          </button>
        </div>
      </div>
    </div>
  );
});

AddColumnModal.displayName = 'AddColumnModal';
