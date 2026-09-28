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
import { getCompanyMember, getCompanyMemberUsage, getCompanySeats, getUserCompanies } from '~/lib/database';
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

  const [members, seats, companies] = await Promise.all([
    getCompanyMemberUsage(companyId, USAGE_WINDOW_DAYS),
    getCompanySeats(companyId),
    getUserCompanies(user.id),
  ]);

  return json({
    user,
    companyId,
    companyName: companies.find((c: any) => c.id === companyId)?.name ?? 'Workspace',
    members,
    seats,
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
  const { companyId, companyName, members, seats, windowDays, user } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
