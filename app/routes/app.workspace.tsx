/**
 * Workspace management — members, their spend, seats and invites.
 *
 * Owner-only, and only for a real workspace: a personal workspace has one member and no seats to
 * manage, so the page would be an empty shell. The nav hides the link under the same conditions,
 * but the check here is the one that matters — hiding a link is not access control.
 */
import { json, redirect, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData, useRevalidator } from '@remix-run/react';
import { useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import { Menu } from '~/components/sidebar/Menu.client';
import { SafeBoundary } from '~/components/ui/SafeBoundary';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireAuth } from '~/lib/auth';
import {
  getCompanyMember,
  getCompanyMemberUsage,
  getCompanySeats,
  getUserCompanies,
  listCompanyInvitations,
} from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { isWorkspaceOwner } from '~/lib/workspace-roles';
import { personalCompanyId } from '~/lib/database-postgresql';
import landingStyles from '~/styles/landing.css?url';

const USAGE_WINDOW_DAYS = 30;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);

  if (companyId === personalCompanyId(user.id)) {
    return redirect('/app/overview');
  }

  const member = await getCompanyMember(companyId, user.id);

  if (!isWorkspaceOwner(member?.role)) {
    return redirect('/app/overview');
  }

  const [members, seats, companies, invitations] = await Promise.all([
    getCompanyMemberUsage(companyId, USAGE_WINDOW_DAYS),
    getCompanySeats(companyId),
    getUserCompanies(user.id),
    listCompanyInvitations(companyId),
  ]);

  return json({
    user,
    companyId,
    companyName: companies.find((c: any) => c.id === companyId)?.name ?? 'Workspace',
    members,
    seats,
    invitations,
    windowDays: USAGE_WINDOW_DAYS,
  });
}

export const links: LinksFunction = () => [
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  },
  { rel: 'stylesheet', href: landingStyles },
];

export const meta: MetaFunction = () => [
  { name: 'robots', content: 'noindex' },
  { title: 'Workspace — Prompify' },
  { name: 'description', content: 'Members, usage and invitations for this workspace.' },
];

function RoleBadge({ role }: { role: string }) {
  const isOwner = role === 'owner' || role === 'admin';

  return (
    <span
      className={
        isOwner
          ? 'text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400'
          : 'text-xs px-2 py-0.5 rounded bg-gray-500/15 text-gray-600 dark:text-gray-400'
      }
    >
      {isOwner ? 'Owner' : role}
    </span>
  );
}

export default function WorkspacePage() {
  const { companyId, companyName, members, seats, invitations, windowDays, user } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('developer');

  const seatsLeft = seats - members.length;

  const invite = async () => {
    setBusy('invite');
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/companies/${companyId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; emailed?: boolean };

      if (!res.ok) {
        setError(data.error ?? 'That invitation could not be sent.');
      } else {
        /*
         * The invitation exists whether or not the mail went out, so say which happened — an owner
         * who thinks an email was sent will wait for a reply that never comes.
         */
        setNotice(
          data.emailed
            ? `Invitation sent to ${inviteEmail}.`
            : `Invitation created for ${inviteEmail}, but the email could not be sent. Check email settings.`
        );
        setInviteEmail('');
        revalidator.revalidate();
      }
    } catch {
      setError('That invitation could not be sent.');
    } finally {
      setBusy(null);
    }
  };

  const revokeInvite = async (invitationId: string) => {
    setBusy(invitationId);
    setError(null);

    try {
      await fetch(`/api/companies/${companyId}/invite`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId }),
      });
      revalidator.revalidate();
    } finally {
      setBusy(null);
    }
  };

  const totalSpent = members.reduce((sum: number, m: any) => sum + m.tokens_spent, 0);

  const mutate = async (body: Record<string, unknown>, method: 'PATCH' | 'DELETE', targetId: string) => {
    setBusy(targetId);
    setError(null);

    try {
      const res = await fetch(`/api/companies/${companyId}/members`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'That change could not be applied.');
      } else {
        revalidator.revalidate();
      }
    } catch {
      setError('That change could not be applied.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <LandingAppChrome>
      <div className="landing-app-chrome flex min-h-0 w-full flex-1 flex-col">
        <SafeBoundary label="sidebar">
          <ClientOnly>{() => <Menu />}</ClientOnly>
        </SafeBoundary>
        <Header />

        <main className="mx-auto w-full max-w-5xl flex-1 overflow-auto px-5 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">{companyName}</h1>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">
              {members.length} of {seats} seats used · {totalSpent.toLocaleString()} tokens spent in the last{' '}
              {windowDays} days.
            </p>
          </div>

          {error ? (
            <div className="mb-6 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="mb-6 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
              {notice}
            </div>
          ) : null}

          <section className="mb-8 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5">
            <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Invite someone</h2>
            <p className="mt-0.5 text-xs text-bolt-elements-textSecondary">
              {seatsLeft > 0
                ? `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left on your plan.`
                : 'Every seat on your plan is taken — upgrade to invite more people.'}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                className="min-w-[220px] flex-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary"
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary"
              >
                <option value="developer">Developer</option>
                <option value="viewer">Viewer</option>
                <option value="owner">Owner</option>
              </select>
              <button
                onClick={invite}
                disabled={busy === 'invite' || !inviteEmail.trim()}
                className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#ea5a0c] disabled:opacity-50"
              >
                {busy === 'invite' ? 'Sending…' : 'Send invite'}
              </button>
            </div>

            {invitations.length > 0 ? (
              <div className="mt-5 border-t border-bolt-elements-borderColor pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">Pending</p>
                <ul className="mt-2 space-y-1.5">
                  {invitations.map((inv: any) => (
                    <li key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-bolt-elements-textPrimary">
                        {inv.email}
                        <span className="ml-2 text-xs text-bolt-elements-textTertiary">
                          {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                        </span>
                      </span>
                      <button
                        onClick={() => revokeInvite(inv.id)}
                        disabled={busy === inv.id}
                        className="text-xs text-bolt-elements-textSecondary hover:text-red-500 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 overflow-hidden">
            <div className="border-b border-bolt-elements-borderColor px-5 py-3">
              <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Members</h2>
              <p className="mt-0.5 text-xs text-bolt-elements-textSecondary">
                Spend is what each person drew from this workspace&apos;s shared pool — their work in other workspaces
                isn&apos;t counted.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-bolt-elements-borderColor text-left text-xs uppercase tracking-wide text-bolt-elements-textSecondary">
                    <th className="px-5 py-2 font-medium">Member</th>
                    <th className="px-5 py-2 font-medium">Role</th>
                    <th className="px-5 py-2 font-medium">Tokens ({windowDays}d)</th>
                    <th className="px-5 py-2 font-medium">Joined</th>
                    <th className="px-5 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m: any) => {
                    const isSelf = m.user_id === user.id;
                    const isOwnerRow = m.role === 'owner' || m.role === 'admin';

                    return (
                      <tr
                        key={m.user_id}
                        className="border-b border-bolt-elements-borderColor last:border-0 hover:bg-bolt-elements-background-depth-2"
                      >
                        <td className="px-5 py-2.5 font-medium text-bolt-elements-textPrimary">
                          {m.email}
                          {isSelf ? (
                            <span className="ml-2 text-xs font-normal text-bolt-elements-textTertiary">you</span>
                          ) : null}
                        </td>
                        <td className="px-5 py-2.5">
                          <RoleBadge role={m.role} />
                        </td>
                        <td className="px-5 py-2.5 text-bolt-elements-textSecondary">
                          {m.tokens_spent.toLocaleString()}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-bolt-elements-textSecondary">
                          {new Date(m.joined_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {/* An owner demoting or removing themselves could leave the workspace unmanageable. */}
                          {isSelf ? null : (
                            <div className="flex justify-end gap-2">
                              <button
                                disabled={busy === m.user_id}
                                onClick={() =>
                                  mutate(
                                    { userId: m.user_id, role: isOwnerRow ? 'developer' : 'owner' },
                                    'PATCH',
                                    m.user_id
                                  )
                                }
                                className="rounded-md border border-bolt-elements-borderColor px-2.5 py-1 text-xs text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 disabled:opacity-50"
                              >
                                {isOwnerRow ? 'Make developer' : 'Make owner'}
                              </button>
                              <button
                                disabled={busy === m.user_id}
                                onClick={() => mutate({ userId: m.user_id }, 'DELETE', m.user_id)}
                                className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </LandingAppChrome>
  );
}
