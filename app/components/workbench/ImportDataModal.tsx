import { memo, useState, useCallback, useRef } from 'react';
import { classNames } from '~/utils/classNames';
import { useCloseOnEscape } from '~/lib/hooks/useCloseOnEscape';
import { buildImportPayload, type ImportPayload } from '~/utils/importTable';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB pre-parse cap

interface ImportDataModalProps {
  chatId: string;
  onClose: () => void;
  onImported: (tableName: string) => void;
}

interface ParsedFile {
  tableName: string;
  headers: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

function sanitizeFilenameToTable(name: string): string {
  const base = (name || '')
    .replace(/\.[^.]+$/, '') // strip extension
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^([^a-z])/, 'col_$1')
    .slice(0, 63);

  return base || 'imported';
}

export const ImportDataModal = memo(({ chatId, onClose, onImported }: ImportDataModalProps) => {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableName, setTableName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setParsed(null);
    setPayload(null);

    if (file.size > MAX_FILE_BYTES) {
      setError('File too large (max 5 MB)');

      return;
    }

    setParsing(true);

    try {
      const ext = file.name.toLowerCase().split('.').pop() || '';
      let headers: string[] = [];
      let rows: Array<Record<string, string | number | boolean | null>> = [];

      if (ext === 'csv') {
        const Papa = (await import('papaparse')).default;
        const text = await file.text();
        const result = Papa.parse<string[]>(text, { skipEmptyLines: true });

        if (result.data.length === 0) {
          setError('CSV is empty');
          return;
        }

        headers = result.data[0].map((h, i) => h || `col_${i + 1}`);
        rows = result.data.slice(1).map(arr => {
          const obj: Record<string, string | number | boolean | null> = {};
          headers.forEach((h, i) => {
            obj[h] = arr[i] ?? null;
          });

          return obj;
        });
      } else if (ext === 'xlsx' || ext === 'xls') {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const ExcelJS = (await import('exceljs')).default;
        const buf = await file.arrayBuffer();
        const wb = new ExcelJS.Workbook();

        await wb.xlsx.load(buf);

        const ws = wb.worksheets[0];

        if (!ws) {
          setError('Workbook has no sheets');
          return;
        }

        const matrix: string[][] = [];

        ws.eachRow({ includeEmpty: false }, row => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, cell => {
            // Coerce everything to string — Date/formula objects become text.
            cells.push(cell.text != null ? String(cell.text) : '');
          });
          matrix.push(cells);
        });

        if (matrix.length === 0) {
          setError('Sheet is empty');
          return;
        }

        headers = matrix[0].map((h, i) => h || `col_${i + 1}`);
        rows = matrix.slice(1).map(arr => {
          const obj: Record<string, string | number | boolean | null> = {};
          headers.forEach((h, i) => {
            const v = arr[i];
            obj[h] = v === '' || v == null ? null : v;
          });

          return obj;
        });
      } else {
        setError('Unsupported file type — use .csv or .xlsx');
        return;
      }

      if (rows.length === 0) {
        setError('No data rows found');
        return;
      }

      const suggested = sanitizeFilenameToTable(file.name);
      const built = buildImportPayload(headers, rows, suggested);

      setParsed({ tableName: suggested, headers, rows });
      setPayload(built);
      setTableName(built.tableName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!payload) {
      return;
    }

    setError(null);
    setImporting(true);

    try {
      const res = await fetch('/api/import-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          tableName: tableName || payload.tableName,
          columns: payload.columns,
          rows: payload.rows,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        rowCount?: number;
        tableName?: string;
      };

      if (!res.ok || data.error) {
        setError(data.error || 'Import failed');
        return;
      }

      onImported(data.tableName || tableName || payload.tableName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setImporting(false);
    }
  }, [payload, chatId, tableName, onImported]);

  // Escape always works, even when the panel is taller than the window.
  useCloseOnEscape(onClose, !importing);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !importing && onClose()}
    >
      {/*
       * flex column + a viewport-bounded max-height so a wide dataset (many columns) can't
       * grow the panel past the screen. Only the body scrolls, which keeps the close button
       * and the action buttons reachable — previously the panel just overflowed and the
       * header scrolled out of reach with no way to dismiss it.
       */}
      <div
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-bolt-elements-borderColor px-5 py-4">
          <h2 className="text-base font-semibold text-bolt-elements-textPrimary">Import Data</h2>
          <button
            onClick={onClose}
            className="i-ph:x text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          />
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {!parsed && (
            <div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={e => {
                  const f = e.target.files?.[0];

                  if (f) {
                    handleFile(f);
                  }
                }}
                className="hidden"
              />
              <button
                onClick={() => inputRef.current?.click()}
                disabled={parsing}
                className={classNames(
                  'w-full rounded-lg border border-dashed border-bolt-elements-borderColor px-4 py-10 text-center transition-colors',
                  parsing
                    ? 'cursor-wait opacity-60'
                    : 'hover:border-accent-500/50 hover:bg-bolt-elements-background-depth-1'
                )}
              >
                <div className="i-ph:upload-simple text-3xl text-bolt-elements-textTertiary mx-auto mb-2" />
                <p className="text-sm text-bolt-elements-textSecondary">
                  {parsing ? 'Parsing…' : 'Choose a .csv or .xlsx file (max 5 MB)'}
                </p>
              </button>
              <div className="mt-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-xs text-bolt-elements-textSecondary">
                Parsed in your browser — the server receives normalized JSON only. Cells with quotes, newlines, and
                unicode are handled. Auto-added: <code>id</code>, <code>created_at</code>, <code>updated_at</code>.
              </div>
            </div>
          )}

          {parsed && payload && (
            <>
              {/* Table name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-bolt-elements-textSecondary">Table name</label>
                <input
                  type="text"
                  value={tableName}
                  onChange={e => setTableName(e.target.value)}
                  className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
                />
              </div>

              {/* Inferred columns */}
              <div>
                <span className="mb-2 block text-xs font-medium text-bolt-elements-textSecondary">
                  Inferred columns ({payload.columns.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {payload.columns.map(c => (
                    <span
                      key={c.name}
                      className="rounded bg-bolt-elements-background-depth-1 px-2 py-0.5 text-xs text-bolt-elements-textSecondary"
                    >
                      <code className="text-bolt-elements-textPrimary">{c.name}</code>
                      <span className="ml-1 text-bolt-elements-textTertiary">{c.type}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Preview rows */}
              <div>
                <span className="mb-2 block text-xs font-medium text-bolt-elements-textSecondary">
                  Preview ({payload.rows.length} rows)
                </span>
                <div className="max-h-48 overflow-auto rounded-lg border border-bolt-elements-borderColor">
                  <table className="w-full text-xs">
                    <thead className="bg-bolt-elements-background-depth-1">
                      <tr>
                        {payload.columns.map(c => (
                          <th key={c.name} className="px-2 py-1 text-left font-medium text-bolt-elements-textSecondary">
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {payload.rows.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-t border-bolt-elements-borderColor">
                          {row.map((cell, j) => (
                            <td key={j} className="px-2 py-1 text-bolt-elements-textPrimary">
                              {cell === null ? (
                                <span className="text-bolt-elements-textTertiary">null</span>
                              ) : (
                                String(cell)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-bolt-elements-borderColor px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-1"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!payload || importing}
            className={classNames(
              'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
              !payload || importing ? 'cursor-not-allowed bg-blue-500/50' : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {importing ? 'Importing…' : `Import${payload ? ` (${payload.rows.length} rows)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
});
