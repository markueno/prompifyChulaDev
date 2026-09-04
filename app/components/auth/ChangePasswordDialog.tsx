import { useState } from 'react';
import { Dialog, DialogRoot } from '~/components/ui/Dialog';

/**
 * Password change for a signed-in user, launched from the account dropdown.
 *
 * A dialog rather than a page because it is a small, self-contained errand — sending someone to a
 * separate screen to change one field loses whatever they were doing. Palette matches
 * `UserProfile`, since that is what opens it.
 */
interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

const FIELD_CLASS =
  'w-full rounded-lg border border-[#fed7aa]/60 dark:border-[#423322] bg-white dark:bg-[#221a10] ' +
  'px-3 py-2 text-sm text-[#231710] dark:text-[#f0e4d5] placeholder:text-[#231710]/40 ' +
  'dark:placeholder:text-[#c4b19a]/50 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316]';

const LABEL_CLASS = 'block text-sm font-medium text-[#231710] dark:text-[#f0e4d5] mb-1.5';

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setError(null);
    setSuccess(false);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    /*
     * Checked here as well as server-side: the confirm field exists only to catch a typo, and
     * making someone wait for a round trip to hear about their own typo is needless.
     */
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }

    setBusy(true);

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = (await response.json()) as { success: boolean; message?: string };

      if (!response.ok || !data.success) {
        setError(data.message || 'Could not update your password.');
        return;
      }

      setSuccess(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={o => !o && close()}>
      <Dialog onClose={close} onBackdrop={close} className="max-w-md">
        <div className="bg-[#f0e4d5] dark:bg-[#2d2014] p-6">
          {success ? (
            <>
              <div className="flex items-center gap-2.5">
                <span className="i-ph:check-circle-duotone text-xl text-green-600 dark:text-green-400" />
                <h2 className="text-lg font-semibold text-[#231710] dark:text-[#f0e4d5]">Password updated</h2>
              </div>
              <p className="mt-3 text-sm text-[#231710]/70 dark:text-[#c4b19a]">
                Your password has been changed. You&apos;re still signed in on this device and any others.
              </p>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <h2 className="text-lg font-semibold text-[#231710] dark:text-[#f0e4d5]">Update password</h2>
              <p className="mt-1.5 text-sm text-[#231710]/70 dark:text-[#c4b19a]">
                At least 8 characters, with an uppercase and lowercase letter, a number, and one of{' '}
                <code className="text-xs">!@#$%^&amp;*</code>.
              </p>

              {error ? (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                >
                  {error}
                </div>
              ) : null}

              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="cp-current" className={LABEL_CLASS}>
                    Current password
                  </label>
                  <input
                    id="cp-current"
                    type={showPasswords ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </div>

                <div>
                  <label htmlFor="cp-new" className={LABEL_CLASS}>
                    New password
                  </label>
                  <input
                    id="cp-new"
                    type={showPasswords ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </div>

                <div>
                  <label htmlFor="cp-confirm" className={LABEL_CLASS}>
                    Confirm new password
                  </label>
                  <input
                    id="cp-confirm"
                    type={showPasswords ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm text-[#231710]/70 dark:text-[#c4b19a]">
                <input
                  type="checkbox"
                  checked={showPasswords}
                  onChange={e => setShowPasswords(e.target.checked)}
                  className="accent-[#f97316]"
                />
                Show passwords
              </label>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-[#231710]/70 dark:text-[#c4b19a] hover:bg-[#fed7aa]/50 dark:hover:bg-[rgba(240,228,213,0.08)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </Dialog>
    </DialogRoot>
  );
}
