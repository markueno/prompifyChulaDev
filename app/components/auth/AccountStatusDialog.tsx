import { useState } from 'react';
import { Dialog, DialogRoot } from '~/components/ui/Dialog';
import { SUPPORT_EMAIL, statusNotice, type AccountStatus } from '~/lib/account-status';

/**
 * Notice shown to a signed-in account that is inactive or suspended.
 *
 * They are deliberately let in rather than blocked at the door: someone locked out cannot read the
 * explanation, and their own work is not what is being withheld. What they cannot do is prompt,
 * which the chat API enforces independently — this dialog only explains why.
 *
 * Dismissable, and it reappears on the next page load. A notice that cannot be closed stops the
 * person reaching the projects they still have every right to look at.
 */
export function AccountStatusDialog({ status }: { status: AccountStatus }) {
  const notice = statusNotice(status);
  const [open, setOpen] = useState(Boolean(notice));

  if (!notice) {
    return null;
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <Dialog onClose={() => setOpen(false)} onBackdrop={() => setOpen(false)} className="max-w-md">
        <div className="bg-[#f0e4d5] p-6 dark:bg-[#2d2014]">
          <div className="flex items-center gap-2.5">
            <span className="i-ph:warning-circle-duotone text-xl text-[#f97316]" />
            <h2 className="text-lg font-semibold text-[#231710] dark:text-[#f0e4d5]">{notice.title}</h2>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-[#231710]/70 dark:text-[#c4b19a]">{notice.body}</p>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-[#231710]/70 hover:bg-[#fed7aa]/50 dark:text-[#c4b19a] dark:hover:bg-[rgba(240,228,213,0.08)]"
            >
              Close
            </button>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Contact us
            </a>
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
}
