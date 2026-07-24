import { useState, useEffect } from 'react';
import { DialogRoot, Dialog, DialogTitle, DialogDescription } from '~/components/ui/Dialog';
import { classNames } from '~/utils/classNames';

const COMPANY_CONTEXT_KEY = 'companyContext';

interface CompanyContextModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = 'idle' | 'fetching' | 'analyzing' | 'done' | 'error';

export function CompanyContextModal({ open, onOpenChange }: CompanyContextModalProps) {
  const [url, setUrl] = useState('');
  const [context, setContext] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      const existing = localStorage.getItem(COMPANY_CONTEXT_KEY);

      if (existing) {
        setContext(existing);
        setPhase('done');
      } else {
        setContext('');
        setPhase('idle');
      }

      setUrl('');
      setError('');
    }
  }, [open]);

  const handleGenerate = async () => {
    if (!url.trim()) {
      return;
    }

    setError('');
    setPhase('fetching');

    try {
      const response = await fetch('/api/generate-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = (await response.json()) as { context?: string; error?: string };

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate context');
      }

      setPhase('analyzing');

      // Small delay for UX
      await new Promise(r => setTimeout(r, 800));

      setContext(data.context || '');
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('error');
    }
  };

  const handleSave = () => {
    if (context.trim()) {
      localStorage.setItem(COMPANY_CONTEXT_KEY, context.trim());
    }

    onOpenChange(false);
  };

  const handleRemove = () => {
    localStorage.removeItem(COMPANY_CONTEXT_KEY);
    setContext('');
    setUrl('');
    setPhase('idle');
    setError('');
  };

  const handleSkip = () => {
    onOpenChange(false);
  };

  const isLoading = phase === 'fetching' || phase === 'analyzing';

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <Dialog className="w-[600px]" showCloseButton={!isLoading}>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-500" />
            Company Context
          </span>
        </DialogTitle>
        <DialogDescription>
          Enter your company website URL and we'll analyze it to generate personalized context for your prompts.
        </DialogDescription>

        <div className="mt-7 space-y-5">
          {phase !== 'done' && (
            <>
              <div>
                <label htmlFor="company-url" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
                  Company website URL
                </label>
                <input
                  id="company-url"
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      handleGenerate();
                    }
                  }}
                  placeholder="https://yourcompany.com"
                  disabled={isLoading}
                  className={classNames(
                    'w-full px-4 py-3 rounded-xl border text-sm',
                    'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                    'focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30',
                    'disabled:opacity-50'
                  )}
                />
              </div>

              {isLoading && (
                <div className="flex items-center gap-3 py-3">
                  <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-bolt-elements-textSecondary">
                    {phase === 'fetching' ? 'Fetching website content...' : 'Analyzing with AI...'}
                  </span>
                </div>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>
              )}
            </>
          )}

          {phase === 'done' && (
            <>
              <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
                Context generated. Review and edit below, then save.
              </div>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                rows={10}
                className={classNames(
                  'w-full px-4 py-3 rounded-xl border text-sm resize-y',
                  'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
                  'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                  'focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30',
                  'leading-relaxed font-mono'
                )}
              />
            </>
          )}
        </div>

        <div className="flex justify-between gap-2 mt-7">
          <div>
            {phase === 'done' && (
              <button
                onClick={handleRemove}
                className="text-sm text-red-500 hover:text-red-600 underline underline-offset-2"
              >
                Remove context
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSkip}
              disabled={isLoading}
              className={classNames(
                'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors',
                'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                'hover:bg-bolt-elements-background-depth-2',
                { 'opacity-50 cursor-not-allowed': isLoading }
              )}
            >
              Skip
            </button>
            {phase === 'done' ? (
              <button
                onClick={handleSave}
                className={classNames(
                  'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  'bg-accent-500 text-white hover:bg-accent-600'
                )}
              >
                Save & Use
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={isLoading || !url.trim()}
                className={classNames(
                  'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  'bg-accent-500 text-white hover:bg-accent-600',
                  { 'opacity-50 cursor-not-allowed': isLoading || !url.trim() }
                )}
              >
                Generate
              </button>
            )}
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
}
