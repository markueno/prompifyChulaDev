import { memo } from 'react';
import { Dialog, DialogRoot } from '~/components/ui/Dialog';

/**
 * Shown when the chat API rejects a prompt for want of tokens — either the plan's pool is empty
 * (`token_balance_exhausted`) or this workspace has hit the ceiling its owner set for it
 * (`workspace_cap_reached`).
 *
 * The two look identical from the composer and are not the same problem at all, which is why this
 * replaced a plain toast. An empty pool needs a bigger plan; a reached cap means the plan still has
 * tokens and someone simply has to raise a number. Sending a member to the pricing page for the
 * second would have them pay for tokens they already own.
 *
 * Dismissable, like the trial dialog: their work is still on screen behind it and the same dialog
 * returns on the next prompt. Trapping someone in a modal they cannot close is how a limit starts
 * reading as hostile.
 */
export type TokensExhaustedReason = 'pool' | 'cap';

interface TokensExhaustedDialogProps {
  open: boolean;
  reason: TokensExhaustedReason;
  /** Present for a reached cap; used to state the actual numbers rather than gesturing at them. */
  cap?: number | null;
  used?: number | null;
  onClose: () => void;
}

export const TokensExhaustedDialog = memo(({ open, reason, cap, used, onClose }: TokensExhaustedDialogProps) => {
  const isCap = reason === 'cap';

  return (
    <DialogRoot open={open} onOpenChange={o => !o && onClose()}>
      <Dialog onClose={onClose} onBackdrop={onClose} className="max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-2.5">
            <span
              className={
                isCap
                  ? 'i-ph:gauge-duotone text-xl text-bolt-elements-item-contentAccent'
                  : 'i-ph:battery-empty-duotone text-xl text-bolt-elements-item-contentAccent'
              }
            />
            <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">
              {isCap ? 'This workspace has reached its token limit' : 'Out of tokens for this period'}
            </h2>
          </div>

          {isCap ? (
            <>
              <p className="mt-3 text-sm text-bolt-elements-textSecondary">
                {typeof cap === 'number' && typeof used === 'number'
                  ? `It has used ${used.toLocaleString()} of its ${cap.toLocaleString()} token limit for this billing period.`
                  : 'It has used the token limit set for this billing period.'}{' '}
                The plan may still have tokens left — they are being held for the owner&apos;s other workspaces.
              </p>
              <p className="mt-3 text-sm text-bolt-elements-textSecondary">
                The workspace owner can raise or remove the limit under{' '}
                <span className="font-medium text-bolt-elements-textPrimary">Workspace settings → Tokens</span>. It also
                resets on its own when the next billing period starts.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-bolt-elements-textSecondary">
              This workspace has used every token on its plan for this billing period. Your projects and history stay
              exactly where they are — a larger plan, or the start of the next period, brings prompting straight back.
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2"
            >
              Close
            </button>
            {/*
             * A reached cap is a setting to change, not something to buy, so this goes to the
             * workspace's own Tokens tab. The route refuses anyone who cannot manage the
             * workspace, which is the right place for that check to live.
             */}
            <a
              href={isCap ? '/app/workspace?tab=tokens' : '/app/pricing'}
              className="rounded-lg bg-bolt-elements-item-contentAccent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              {isCap ? 'Open workspace settings' : 'See plans'}
            </a>
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
});

TokensExhaustedDialog.displayName = 'TokensExhaustedDialog';
