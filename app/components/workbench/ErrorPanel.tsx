import { memo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { errorsStore, clearFixed, clearAll } from '~/lib/stores/errors';
import { workbenchStore } from '~/lib/stores/workbench';
import type { AppError } from '~/types/actions';

const SOURCE_LABEL: Record<string, string> = {
  terminal: 'TERMINAL',
  runtime: 'RUNTIME',
  console: 'CONSOLE',
  network: 'NETWORK',
  build: 'BUILD',
  review: 'REVIEW',
};

const SOURCE_COLOR: Record<string, string> = {
  terminal: 'bg-red-500/20 text-red-400 border border-red-500/30',
  runtime: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  console: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  network: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  build: 'bg-red-500/20 text-red-400 border border-red-500/30',
  review: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);

  if (s < 60) {
    return `${s}s ago`;
  }

  if (s < 3600) {
    return `${Math.floor(s / 60)}m ago`;
  }

  return `${Math.floor(s / 3600)}h ago`;
}

interface ErrorRowProps {
  error: AppError;
  onFix: (error: AppError) => void;
}

const ErrorRow = memo(({ error, onFix }: ErrorRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const isActive = error.status === 'new' || error.status === 'fixing';

  return (
    <div className="border-b border-bolt-elements-borderColor last:border-0">
      <div
        className={`flex items-start gap-2 px-3 py-2 cursor-pointer select-none ${
          isActive ? 'hover:bg-bolt-elements-background-depth-3' : 'opacity-50'
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Severity dot */}
        <div
          className={`shrink-0 mt-1 w-2.5 h-2.5 rounded-full ${
            error.level === 'error' ? 'bg-red-500' : 'bg-yellow-500'
          }`}
        />

        <div className="flex-1 min-w-0">
          {/* Top row: source badge + status + time */}
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                SOURCE_COLOR[error.source] || 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {SOURCE_LABEL[error.source] || error.source.toUpperCase()}
            </span>
            {error.status === 'fixing' && (
              <span className="text-[10px] text-blue-400 flex items-center gap-1">
                <div className="i-ph:spinner animate-spin w-3 h-3" />
                Fixing…
              </span>
            )}
            {error.status === 'fixed' && (
              <span className="text-[10px] text-green-400 flex items-center gap-1">
                <div className="i-ph:check-circle w-3 h-3" />
                Fixed
              </span>
            )}
            {error.status === 'ignored' && <span className="text-[10px] text-bolt-elements-textTertiary">Ignored</span>}
            <span className="text-[10px] text-bolt-elements-textTertiary ml-auto shrink-0">
              {timeAgo(error.timestamp)}
            </span>
          </div>

          {/* Message */}
          <div className="text-xs text-bolt-elements-textPrimary leading-tight truncate">{error.message}</div>

          {/* File:line */}
          {error.file && (
            <div className="text-[10px] text-bolt-elements-textTertiary mt-0.5">
              {error.file}
              {error.line ? `:${error.line}` : ''}
            </div>
          )}
        </div>

        {/* Fix button */}
        {error.status === 'new' && (
          <button
            className="shrink-0 text-[11px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
            onClick={e => {
              e.stopPropagation();
              onFix(error);
            }}
          >
            Fix
          </button>
        )}

        {/* Expand caret */}
        {error.stack && (
          <div
            className={`shrink-0 i-ph:caret-down text-bolt-elements-textTertiary transition-transform duration-150 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        )}
      </div>

      {/* Stack trace */}
      {expanded && error.stack && (
        <pre className="px-4 py-2 text-[10px] text-bolt-elements-textSecondary bg-bolt-elements-background-depth-1 overflow-x-auto whitespace-pre-wrap font-mono max-h-36 border-t border-bolt-elements-borderColor">
          {error.stack}
        </pre>
      )}
    </div>
  );
});

interface ErrorPanelProps {
  onFixError: (error: AppError) => void;
  onFixAll: () => void;
}

export const ErrorPanel = memo(({ onFixError, onFixAll }: ErrorPanelProps) => {
  const errors = useStore(errorsStore);

  const activeErrors = errors.filter(e => e.status === 'new');
  const errorCount = activeErrors.filter(e => e.level === 'error').length;
  const warnCount = activeErrors.filter(e => e.level === 'warn').length;
  const hasFixed = errors.some(e => e.status === 'fixed');

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor shrink-0">
        <div className="i-ph:warning-circle text-bolt-elements-textSecondary" />
        <span className="text-sm font-medium text-bolt-elements-textPrimary">Problems</span>

        {errorCount > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </span>
        )}
        {warnCount > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            {warnCount} warn{warnCount !== 1 ? 's' : ''}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {activeErrors.length > 1 && (
            <button
              className="text-[11px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
              onClick={onFixAll}
              title="Ask AI to fix all active errors at once"
            >
              Fix All
            </button>
          )}
          {hasFixed && (
            <button
              className="text-[11px] px-2 py-0.5 rounded bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive transition-colors"
              onClick={clearFixed}
              title="Remove fixed entries"
            >
              Clear Fixed
            </button>
          )}
          {errors.length > 0 && (
            <button
              className="text-[11px] px-2 py-0.5 rounded bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive transition-colors"
              onClick={clearAll}
              title="Clear all entries"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Error list */}
      <div className="flex-1 overflow-y-auto">
        {errors.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-bolt-elements-textTertiary py-12">
            <div className="i-ph:check-circle text-3xl text-green-500/70" />
            <span className="text-sm">No problems detected</span>
          </div>
        ) : (
          errors
            .slice()
            .reverse()
            .map(error => <ErrorRow key={error.id} error={error} onFix={onFixError} />)
        )}
      </div>
    </div>
  );
});

// Standalone badge — used in the workbench header to show active error count
export const ErrorBadge = memo(() => {
  const errors = useStore(errorsStore);
  const count = errors.filter(e => e.status === 'new' && e.level === 'error').length;

  if (count === 0) {
    return null;
  }

  return (
    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
      {count > 9 ? '9+' : count}
    </span>
  );
});

// Helper used by Workbench to enqueue a fix request via the existing alert mechanism
export function requestFixForError(error: AppError): void {
  workbenchStore.enqueueAlert({
    type: 'error',
    source: error.source === 'terminal' || error.source === 'build' ? 'terminal' : 'preview',
    title: `${SOURCE_LABEL[error.source] || 'App'} Error`,
    description: error.message,
    content: error.stack || error.message,
  });
}
