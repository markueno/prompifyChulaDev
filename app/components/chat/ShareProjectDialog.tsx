import { useEffect, useRef, useState } from 'react';
import { classNames } from '~/utils/classNames';
import {
  ASSIGNABLE_PROJECT_ROLES,
  PROJECT_ROLE_DESCRIPTIONS,
  PROJECT_ROLE_LABELS,
  type ProjectRole,
} from '~/lib/project-roles';

/**
 * Share one project with one person, by email and at a chosen role.
 *
 * Until this existed, inviting was reachable only from the admin tab inside a project's workbench
 * — so sharing meant opening the project first and knowing which tab it was under. Sharing is
 * something you decide about a project from the outside, which is where the list is.
 *
 * The role's consequence is shown next to the choice rather than left to the label. "Viewer" does
 * not say on its own that it withholds the conversation, and this is the moment someone decides
 * how much of their work to hand over.
 */
interface ShareProjectDialogProps {
  chatId: string;
  projectName: string;
  onClose: () => void;
}

export function ShareProjectDialog({ chatId, projectName, onClose }: ShareProjectDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();

    const address = email.trim();

    if (!address || sending) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: address, role }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        token?: string;
        alreadyMember?: boolean;
        message?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not send the invitation');
      }

      if (data.alreadyMember) {
        setError(data.message || 'This person already has access to the project.');
        return;
      }

      setSentTo(address);
      setEmail('');

      /*
       * The link is offered alongside the email, not instead of it. Delivery is the part most
       * likely to go wrong — an unverified sending domain, a spam filter — and having the link to
       * hand means a failed email is an inconvenience rather than a dead end.
       */
      if (data.token) {
        setInviteLink(`${window.location.origin}/invite/accept?token=${data.token}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the invitation');
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the link is selectable in the field either way.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${projectName}`}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#fed7aa]/60 bg-[#f0e4d5] p-6 shadow-xl dark:border-white/10 dark:bg-[#231710]"
        onClick={event => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[#231710] dark:text-white">Share project</h2>
        <p className="mt-1 truncate text-sm text-[#231710]/60 dark:text-white/60" title={projectName}>
          {projectName}
        </p>

        <form onSubmit={send} className="mt-5">
          <label htmlFor="share-email" className="block text-sm font-medium text-[#231710] dark:text-white">
            Email address
          </label>
          <input
            id="share-email"
            ref={emailRef}
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="mt-1.5 w-full rounded-lg border border-[#231710]/20 bg-white px-3 py-2 text-sm text-[#231710] focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316] dark:border-white/20 dark:bg-[#1a120a] dark:text-white"
          />

          <label htmlFor="share-role" className="mt-4 block text-sm font-medium text-[#231710] dark:text-white">
            Role
          </label>
          <select
            id="share-role"
            value={role}
            onChange={e => setRole(e.target.value as ProjectRole)}
            className="mt-1.5 w-full rounded-lg border border-[#231710]/20 bg-white px-3 py-2 text-sm text-[#231710] focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316] dark:border-white/20 dark:bg-[#1a120a] dark:text-white"
          >
            {ASSIGNABLE_PROJECT_ROLES.map(r => (
              <option key={r} value={r}>
                {PROJECT_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-[#231710]/60 dark:text-white/60">{PROJECT_ROLE_DESCRIPTIONS[role]}</p>

          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {sentTo && !error && (
            <p className="mt-3 text-sm text-green-700 dark:text-green-400">
              Invitation sent to <span className="font-medium">{sentTo}</span>.
            </p>
          )}

          {inviteLink && (
            <div className="mt-3 rounded-lg border border-[#231710]/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-[#231710]/60 dark:text-white/60">
                Or send this link yourself — they must accept it signed in as that address.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  onFocus={e => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border border-[#231710]/15 bg-white px-2 py-1.5 text-xs text-[#231710] dark:border-white/15 dark:bg-[#1a120a] dark:text-white"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="shrink-0 rounded-md border border-[#231710]/20 px-2.5 py-1.5 text-xs font-medium text-[#231710] transition-colors hover:bg-[#231710]/5 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#231710]/20 px-4 py-2 text-sm text-[#231710] transition-colors hover:bg-[#231710]/5 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
            >
              {sentTo ? 'Done' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className={classNames(
                'rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white transition-opacity',
                sending || !email.trim() ? 'opacity-50' : 'hover:opacity-90'
              )}
            >
              {sending ? 'Sending…' : sentTo ? 'Send another' : 'Send invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
