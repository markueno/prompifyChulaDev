import { useEffect, useState } from 'react';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { classNames } from '~/utils/classNames';

interface AddWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddWorkspaceModal({ open, onClose }: AddWorkspaceModalProps) {
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<{ max: number; owned: number; canCreate: boolean } | null>(null);

  // Fetched when the modal opens rather than on mount, so a closed modal costs nothing.
  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    fetch('/api/companies')
      .then(r => (r.ok ? (r.json() as Promise<{ allowance?: typeof allowance }>) : { allowance: null }))
      .then(d => {
        if (!cancelled) {
          setAllowance(d.allowance ?? null);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();

    if (!code) {
      setError('Please enter an invite code.');
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const res = await fetch('/api/companies/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to join workspace');
      }

      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join workspace');
      setJoining(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={v => !v && onClose()}>
      <Dialog className="p-6">
        <DialogTitle>Add a workspace</DialogTitle>
        <DialogDescription>Join an existing team or create a new one.</DialogDescription>

        <div className="mt-6 space-y-6">
          {/* Join with code */}
          <div>
            <label className="block text-sm font-medium text-bolt-elements-textPrimary">Join with invite code</label>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={e => {
                  setJoinCode(e.target.value);
                  setError(null);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !joining) {
                    handleJoin();
                  }
                }}
                placeholder="e.g. AX4K9B2M"
                maxLength={8}
                className={classNames(
                  'flex-1 rounded-lg border bg-bolt-elements-background-depth-1 px-3 py-2 text-sm',
                  'border-bolt-elements-borderColor text-bolt-elements-textPrimary',
                  'placeholder:text-bolt-elements-textSecondary',
                  'focus:outline-none focus:ring-2 focus:ring-[#f97316]/40 focus:border-[#f97316]',
                  'uppercase tracking-wider font-mono'
                )}
              />
              <button
                type="button"
                onClick={handleJoin}
                disabled={joining}
                className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#ea5a0c] disabled:opacity-50"
              >
                {joining ? 'Joining...' : 'Join'}
              </button>
            </div>
            {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-bolt-elements-borderColor" />
            <span className="text-xs text-bolt-elements-textSecondary">or</span>
            <div className="h-px flex-1 bg-bolt-elements-borderColor" />
          </div>

          {/*
           * Creating is enterprise-only, so an account that can't do it is told here rather than
           * after filling in a form. The server refuses either way; this only saves the walk.
           * While the allowance is still loading, show the link — a flash of "upgrade" for
           * someone entitled to create is the worse mistake.
           */}
          {allowance && !allowance.canCreate ? (
            <a
              href="/app/pricing"
              className="flex items-center justify-between rounded-lg border border-[#f97316]/40 bg-[#f97316]/10 px-4 py-3 transition-colors hover:border-[#f97316]"
            >
              <div>
                <p className="text-sm font-medium text-bolt-elements-textPrimary">
                  {allowance.max === 0 ? 'Creating a workspace needs an enterprise plan' : 'Workspace limit reached'}
                </p>
                <p className="text-xs text-bolt-elements-textSecondary">
                  {allowance.max === 0
                    ? 'You can still join someone else’s workspace with an invite or a code.'
                    : `Your plan allows ${allowance.max}; you have ${allowance.owned}.`}
                </p>
              </div>
              <span className="i-ph:arrow-right text-base text-bolt-elements-textSecondary" />
            </a>
          ) : (
            <a
              href="/company/new"
              className="flex items-center justify-between rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 py-3 transition-colors hover:border-[#f97316]"
            >
              <div>
                <p className="text-sm font-medium text-bolt-elements-textPrimary">Create a new team</p>
                <p className="text-xs text-bolt-elements-textSecondary">
                  Set up a shared workspace for your organization.
                </p>
              </div>
              <span className="i-ph:arrow-right text-base text-bolt-elements-textSecondary" />
            </a>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <DialogButton type="secondary" onClick={onClose}>
            Close
          </DialogButton>
        </div>
      </Dialog>
    </DialogRoot>
  );
}
