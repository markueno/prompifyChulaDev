import { memo, useState, useEffect, useCallback } from 'react';
import { classNames } from '~/utils/classNames';
import { useCloseOnEscape } from '~/lib/hooks/useCloseOnEscape';
import { listAllUserTables, linkExistingTable } from '~/lib/stores/data-proxy-client';
import type { SupabaseTable } from '~/types/supabase-admin';

interface LinkExistingTableModalProps {
  chatId: string;
  /** logical names already linked into the current chat (hidden from the list). */
  currentTableNames: string[];
  onClose: () => void;
  onLinked: (tableName: string) => void;
}

/*
 * Opt-in "link existing table": lists the user's tables from OTHER chats and
 * links the chosen one into the current chat. Linking SHARES that physical
 * table's rows between the projects — so it only runs on this explicit action,
 * never automatically (the AI's data action always creates a fresh, isolated
 * table per project).
 */
export const LinkExistingTableModal = memo(
  ({ chatId, currentTableNames, onClose, onLinked }: LinkExistingTableModalProps) => {
    const [tables, setTables] = useState<SupabaseTable[]>([]);
    const [loading, setLoading] = useState(true);
    const [linkingName, setLinkingName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let active = true;

      (async () => {
        const all = await listAllUserTables(chatId);

        if (!active) {
          return;
        }

        const current = new Set(currentTableNames);
        setTables(all.filter(t => !current.has(t.name)));
        setLoading(false);
      })();

      return () => {
        active = false;
      };
    }, [chatId]);

    const handleLink = useCallback(
      async (name: string) => {
        setError(null);
        setLinkingName(name);

        const res = await linkExistingTable(chatId, name);

        setLinkingName(null);

        if (res.success) {
          onLinked(name);
        } else {
          setError(res.error || 'Failed to link table');
        }
      },
      [chatId, onLinked]
    );

    useCloseOnEscape(onClose, !linkingName);

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onClick={() => !linkingName && onClose()}
      >
        <div
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-bolt-elements-borderColor px-5 py-4">
            <h2 className="text-base font-semibold text-bolt-elements-textPrimary">Link existing table</h2>
            <button
              onClick={onClose}
              className="i-ph:x text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
            />
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-3 text-xs text-bolt-elements-textSecondary">
              Pull a table from another project into this one. The two projects will share that table&apos;s rows — link
              only when you want them to share data.
            </p>

            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-bolt-elements-textTertiary">
                <span className="i-ph:circle-notch animate-spin" />
                Loading your tables…
              </div>
            ) : tables.length === 0 ? (
              <p className="py-6 text-center text-sm text-bolt-elements-textTertiary">
                No other tables to link. Create or import data in another project first.
              </p>
            ) : (
              <div className="space-y-2">
                {tables.map(t => (
                  <button
                    key={t.name}
                    onClick={() => !linkingName && handleLink(t.name)}
                    disabled={!!linkingName}
                    className={classNames(
                      'flex w-full items-center justify-between rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-left transition-colors',
                      linkingName ? 'cursor-not-allowed opacity-60' : 'hover:bg-bolt-elements-background-depth-3'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="i-ph:database text-base text-bolt-elements-textTertiary" />
                      <span className="text-sm font-medium text-bolt-elements-textPrimary">{t.name}</span>
                    </span>
                    <span className="text-xs text-bolt-elements-textTertiary">
                      {t.columns.length} col{t.columns.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 justify-end border-t border-bolt-elements-borderColor px-5 py-4">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-1"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }
);

LinkExistingTableModal.displayName = 'LinkExistingTableModal';
