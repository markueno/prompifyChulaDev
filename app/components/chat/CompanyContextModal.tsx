import { useState, useEffect } from 'react';
import { DialogRoot, Dialog, DialogTitle, DialogDescription } from '~/components/ui/Dialog';
import { classNames } from '~/utils/classNames';
import { syncWorkspaceContext, saveWorkspaceContext, deleteWorkspaceContext } from '~/lib/workspaceContext.client';

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      /*
       * Load from the workspace rather than this browser. syncWorkspaceContext also migrates a
       * pre-workspace localStorage copy up on first run, so an existing user's context is not lost.
       */
      void syncWorkspaceContext().then(existing => {
        if (existing) {
          setContext(existing);
          setPhase('done');
        } else {
          setContext('');
          setPhase('idle');
        }
      });

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

      await new Promise(r => setTimeout(r, 800));

      setContext(data.context || '');
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('error');
    }
  };

  const handleSave = async () => {
    const trimmed = context.trim();

    if (trimmed) {
      setSaving(true);

      const ok = await saveWorkspaceContext(trimmed, url.trim() || null);
      setSaving(false);

      if (!ok) {
        setError('Could not save to your workspace. Try again.');
        return;
      }
    }

    onOpenChange(false);
  };

  const handleRemove = async () => {
    await deleteWorkspaceContext();
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
      <Dialog className="w-[720px]" showCloseButton={!isLoading}>
        <div className="px-6 py-5">
          <DialogTitle>
            <span className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-accent-500" />
              Company Context
            </span>
          </DialogTitle>
          <DialogDescription>
            Enter your company website URL and we'll analyze it to generate personalized context for your AI prompts.
          </DialogDescription>

          {phase !== 'done' && (
            <div className="mt-8 space-y-5">
              <div>
                <label htmlFor="company-url" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
                  Company website URL
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                      <path
                        d="M2 8h12M8 2c1.5 2 2.5 4 2.5 6s-1 4-2.5 6M8 2c-1.5 2-2.5 4-2.5 6s1 4 2.5 6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
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
                      'w-full pl-10 pr-4 py-3 rounded-xl border text-sm',
                      'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
                      'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                      'focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20',
                      'disabled:opacity-50'
                    )}
                  />
                </div>
              </div>

              {isLoading && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-500/5 border border-accent-500/20">
                  <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-medium text-accent-600">
                    {phase === 'fetching' ? 'Fetching website content...' : 'Analyzing with AI...'}
                  </span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 mt-0.5">
                    <circle cx="8" cy="8" r="6" stroke="#dc2626" strokeWidth="1.5" />
                    <path d="M8 5v3M8 10.5v.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="mt-8 space-y-5">
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                  <circle cx="8" cy="8" r="6" stroke="#16a34a" strokeWidth="1.5" />
                  <path
                    d="M5 8l2 2 4-5"
                    stroke="#16a34a"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-sm font-medium text-green-800">Context generated — review and edit below</span>
              </div>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                rows={14}
                className={classNames(
                  'w-full px-4 py-3.5 rounded-xl border text-sm resize-y',
                  'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
                  'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                  'focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20',
                  'leading-relaxed'
                )}
              />
            </div>
          )}

          <div className="flex justify-between gap-2 mt-8">
            <div>
              {phase === 'done' && (
                <button
                  onClick={handleRemove}
                  className="text-sm text-red-500 hover:text-red-600 underline underline-offset-2 transition-colors"
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
                  'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2',
                  { 'opacity-50 cursor-not-allowed': isLoading }
                )}
              >
                Skip
              </button>
              {phase === 'done' ? (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={classNames(
                    'inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors',
                    { 'opacity-60 cursor-not-allowed': saving }
                  )}
                >
                  {saving ? 'Saving…' : 'Save & Use'}
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={isLoading || !url.trim()}
                  className={classNames(
                    'inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors',
                    { 'opacity-50 cursor-not-allowed': isLoading || !url.trim() }
                  )}
                >
                  Generate
                </button>
              )}
            </div>
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
}
