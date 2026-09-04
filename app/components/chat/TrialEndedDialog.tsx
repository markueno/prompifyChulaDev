import { memo } from 'react';
import { Dialog, DialogRoot } from '~/components/ui/Dialog';
import { PAID_PLANS, TRIAL_PROMPT_LIMIT, formatPrice, formatTokens } from '~/lib/billing/plans';

/**
 * Shown when the chat API rejects a prompt with `trial_exhausted`.
 *
 * Deliberately not a toast: a toast is for something you can dismiss and carry on past, and this
 * is the opposite — nothing else the person tries will work until they pick a plan. It is also
 * where the trial's value has to be argued, which needs more than one line.
 *
 * Dismissable on purpose. Trapping someone in a modal they cannot close is how a paywall reads as
 * hostile, and their work is still on screen behind it; the same dialog returns on the next prompt.
 */
interface TrialEndedDialogProps {
  open: boolean;
  onClose: () => void;
}

/** The cheapest paid plan, used as the headline suggestion. Falls back gracefully if reordered. */
const SUGGESTED = [...PAID_PLANS].sort((a, b) => a.priceCents - b.priceCents)[0];

export const TrialEndedDialog = memo(({ open, onClose }: TrialEndedDialogProps) => {
  return (
    <DialogRoot open={open} onOpenChange={o => !o && onClose()}>
      <Dialog onClose={onClose} onBackdrop={onClose} className="max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-2.5">
            <span className="i-ph:rocket-launch-duotone text-xl text-bolt-elements-item-contentAccent" />
            <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">Your free trial has ended</h2>
          </div>

          <p className="mt-3 text-sm text-bolt-elements-textSecondary">
            You&apos;ve used all {TRIAL_PROMPT_LIMIT} of your trial prompts. Choose a plan to keep building — your
            projects and chat history stay exactly where they are.
          </p>

          {SUGGESTED ? (
            <div className="mt-5 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-bolt-elements-textPrimary">{SUGGESTED.displayName}</span>
                <span className="text-sm text-bolt-elements-textSecondary">
                  <span className="font-semibold text-bolt-elements-textPrimary">
                    {formatPrice(SUGGESTED.priceCents)}
                  </span>
                  /mo
                </span>
              </div>
              <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                {formatTokens(SUGGESTED.tokens)} tokens every month — enough to build and iterate properly.
              </p>
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2"
            >
              Not now
            </button>
            <a
              href="/app/pricing"
              className="rounded-lg bg-bolt-elements-item-contentAccent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              See plans
            </a>
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
});

TrialEndedDialog.displayName = 'TrialEndedDialog';
