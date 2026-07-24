import { useState, useEffect } from 'react';
import { DialogRoot, Dialog, DialogTitle, DialogDescription, DialogButton } from '~/components/ui/Dialog';
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
      <Dialog className="w-[560px]" showCloseButton={!isLoading}>
        <DialogTitle>Company Context</DialogTitle>
        <DialogDescription>
          Enter your company website URL and we'll analyze it to generate personalized context for your prompts.
        </DialogDescription>

        <div className="mt-5 space-y-4">
          {phase !== 'done' && (
            <>
              <div>
                <label
                  htmlFor="company-url"
                  className="block text-sm font-medium text-bolt-elements-textPrimary mb-1.5"
                >
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
                    'w-full px-3.5 py-2.5 rounded-lg border text-sm',
                    'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                    'focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30',
                    'disabled:opacity-50'
                  )}
                />
              </div>

              {isLoading && (
                <div className="flex items-center gap-3 py-2">
                  <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-bolt-elements-textSecondary">
                    {phase === 'fetching' ? 'Fetching website content...' : 'Analyzing with AI...'}
                  </span>
                </div>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
              )}
            </>
          )}

          {phase === 'done' && (
            <>
              <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
                Context generated. Review and edit below, then save.
              </div>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                rows={10}
                className={classNames(
                  'w-full px-3.5 py-2.5 rounded-lg border text-sm resize-y',
                  'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
                  'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                  'focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30',
                  'leading-relaxed font-mono'
                )}
              />
            </>
          )}
        </div>

        <div className="flex justify-between gap-2 mt-6">
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
          <div className="flex gap-2">
            <DialogButton type="secondary" onClick={handleSkip} disabled={isLoading}>
              Skip
            </DialogButton>
            {phase === 'done' ? (
              <DialogButton type="primary" onClick={handleSave}>
                Save & Use
              </DialogButton>
            ) : (
              <DialogButton type="primary" onClick={handleGenerate} disabled={isLoading || !url.trim()}>
                Generate
              </DialogButton>
            )}
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
}
