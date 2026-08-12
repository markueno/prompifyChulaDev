/**
 * Platform admin console. Superadmin only.
 *
 * The loader calls requireSuperadmin, which throws a 404 Response for everyone else — so the
 * route is invisible rather than merely forbidden. All mutations go through /api/admin/users,
 * which re-checks the same guard; nothing here is trusted to be the only gate.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { json, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { toast } from 'react-toastify';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import { Menu } from '~/components/sidebar/Menu.client';
import { SafeBoundary } from '~/components/ui/SafeBoundary';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireSuperadmin } from '~/lib/auth';
import { PLANS, formatTokens } from '~/lib/billing/plans';
import type { AdminUserRow } from '~/lib/admin/admin-db.server';
import { classNames } from '~/utils/classNames';
import landingStyles from '~/styles/landing.css?url';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireSuperadmin(request, context);
  return json({ user });
}

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: landingStyles }];

export const meta: MetaFunction = () => [{ name: 'robots', content: 'noindex' }, { title: 'Admin — Prompify' }];

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export default function AdminConsole() {
  const { user: admin } = useLoaderData<typeof loader>();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const [grantAmount, setGrantAmount] = useState('');
  const [tierChoice, setTierChoice] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const load = useCallback(async (term: string) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(term)}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as { users: AdminUserRow[]; total: number };
      setUsers(data.users);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  /** Refresh the selected row from a freshly loaded list so the drawer never shows stale numbers. */
  useEffect(() => {
    if (selected) {
      const fresh = users.find(u => u.id === selected.id);

      if (fresh && fresh !== selected) {
        setSelected(fresh);
      }
    }
  }, [users, selected]);

  const runAction = useCallback(
    async (body: Record<string, unknown>, successMessage: string) => {
      setBusy(true);

      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = (await res.json()) as { error?: string };

        if (!res.ok || data.error) {
          toast.error(data.error || `HTTP ${res.status}`);
          return false;
        }

        toast.success(successMessage);
        await load(search);

        return true;
      } catch {
        toast.error('Action failed');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, search]
  );

  const totals = useMemo(
    () => ({
      users: total,
      suspended: users.filter(u => !u.tokenApproved).length,
      paying: users.filter(u => u.stripeSubscriptionId).length,
    }),
    [users, total]
  );

  return (
    <LandingAppChrome>
      <div className="landing-app-chrome flex min-h-0 w-full flex-1 flex-col">
        {/* Chat history sidebar — same hover-out drawer the chat page has. Wrapped so a
            failure in this incidental widget can't replace the whole page with the route
            error boundary. */}
        <SafeBoundary label="sidebar">
          <ClientOnly>{() => <Menu />}</ClientOnly>
        </SafeBoundary>
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 overflow-auto px-5 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">Admin</h1>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">
              {totals.users} users · {totals.paying} on Stripe · {totals.suspended} suspended
            </p>
          </div>

          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="mb-4 w-full max-w-sm rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
          />

          {/*
           * This page renders over LandingAppChrome's full-bleed photo background, so the table
           * needs its own opaque surface — without one the rows were transparent and the only
           * thing that painted was the hover, which is why hovering appeared to "turn the row
           * white" and swallow the text. Same treatment the Overview cards use.
           */}
          <div className="overflow-x-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-sm">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-left">
                  <th className="px-4 py-2.5 font-medium text-bolt-elements-textSecondary">Email</th>
                  <th className="px-4 py-2.5 font-medium text-bolt-elements-textSecondary">Plan</th>
                  <th className="px-4 py-2.5 font-medium text-bolt-elements-textSecondary">Tokens left</th>
                  <th className="px-4 py-2.5 font-medium text-bolt-elements-textSecondary">Projects</th>
                  <th className="px-4 py-2.5 font-medium text-bolt-elements-textSecondary">Joined</th>
                  <th className="px-4 py-2.5 font-medium text-bolt-elements-textSecondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-bolt-elements-textTertiary">
                      Loading…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-bolt-elements-textTertiary">
                      No users match “{search}”.
                    </td>
                  </tr>
                ) : (
                  users.map(u => (
                    <tr
                      key={u.id}
                      onClick={() => {
                        setSelected(u);
                        setGrantAmount('');
                        setTierChoice(u.tierId ?? '');
                        setDeleteConfirm('');
                      }}
                      /*
                       * Hover is an accent tint rather than a surface swap, so the row's own text
                       * colours stay valid in both themes — a solid hover background is what made
                       * the labels disappear before.
                       */
                      className="cursor-pointer border-b border-bolt-elements-borderColor/50 last:border-b-0 transition-colors hover:bg-accent-500/15"
                    >
                      <td className="px-4 py-2.5 text-bolt-elements-textPrimary">
                        {u.email}
                        {u.isSuperadmin && <span className="ml-2 text-xs text-accent-500">admin</span>}
                      </td>
                      <td className="px-4 py-2.5 text-bolt-elements-textSecondary">
                        {u.tierName ?? '—'}
                        {u.stripeSubscriptionId && (
                          <span className="ml-1.5 text-xs text-bolt-elements-textTertiary">(Stripe)</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-bolt-elements-textSecondary">
                        {formatTokens(u.tokensRemaining)}
                      </td>
                      <td className="px-4 py-2.5 text-bolt-elements-textSecondary">{u.projectCount}</td>
                      <td className="px-4 py-2.5 text-bolt-elements-textSecondary">{formatDate(u.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={classNames(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            u.tokenApproved
                              ? 'bg-green-500/15 text-green-600 dark:text-green-300'
                              : 'bg-red-500/15 text-red-600 dark:text-red-300'
                          )}
                        >
                          {u.tokenApproved ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => !busy && setSelected(null)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-bolt-elements-textPrimary">{selected.email}</h2>
                <p className="mt-0.5 text-xs text-bolt-elements-textTertiary">
                  Joined {formatDate(selected.createdAt)} · Last login {formatDate(selected.lastLogin)}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="i-ph:x shrink-0 text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
              />
            </div>

            <dl className="mb-6 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-bolt-elements-textTertiary">Plan</dt>
                <dd className="text-bolt-elements-textPrimary">{selected.tierName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-bolt-elements-textTertiary">Tokens used / granted</dt>
                <dd className="text-bolt-elements-textPrimary">
                  {formatTokens(selected.tokensUsed)} / {formatTokens(selected.tokensAllocated)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-bolt-elements-textTertiary">Projects</dt>
                <dd className="text-bolt-elements-textPrimary">{selected.projectCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-bolt-elements-textTertiary">Chats</dt>
                <dd className="text-bolt-elements-textPrimary">{selected.chatCount}</dd>
              </div>
            </dl>

            {/* Grant tokens */}
            <section className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">
                Grant tokens
              </h3>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  value={grantAmount}
                  onChange={e => setGrantAmount(e.target.value)}
                  placeholder="e.g. 1000000"
                  className="flex-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                />
                <button
                  disabled={busy || !grantAmount}
                  onClick={async () => {
                    if (
                      await runAction(
                        { action: 'grantTokens', userId: selected.id, tokens: Number(grantAmount) },
                        'Tokens granted'
                      )
                    ) {
                      setGrantAmount('');
                    }
                  }}
                  className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-40"
                >
                  Grant
                </button>
              </div>
              <p className="mt-1 text-xs text-bolt-elements-textTertiary">
                Added as a non-expiring top-up, same as a purchased pack.
              </p>
            </section>

            {/* Change tier */}
            <section className="mb-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">
                Change plan
              </h3>
              {selected.stripeSubscriptionId ? (
                <p className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-xs text-bolt-elements-textSecondary">
                  This account pays through Stripe. Change the plan in Stripe instead — editing it here would be
                  overwritten by the next webhook.
                </p>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={tierChoice}
                    onChange={e => setTierChoice(e.target.value)}
                    className="flex-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                  >
                    <option value="">Select a plan…</option>
                    {PLANS.map(p => (
                      <option key={p.tierId} value={p.tierId}>
                        {p.displayName} — {formatTokens(p.tokens)} tokens
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || !tierChoice || tierChoice === selected.tierId}
                    onClick={() =>
                      void runAction({ action: 'changeTier', userId: selected.id, tierId: tierChoice }, 'Plan changed')
                    }
                    className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              )}
            </section>

            {/* Suspend / delete */}
            <section className="border-t border-bolt-elements-borderColor pt-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">
                Account
              </h3>

              <button
                disabled={busy || selected.id === admin.id}
                onClick={() =>
                  void runAction(
                    { action: 'setSuspended', userId: selected.id, suspended: selected.tokenApproved },
                    selected.tokenApproved ? 'Account suspended' : 'Account restored'
                  )
                }
                className="mb-4 w-full rounded-lg border border-bolt-elements-borderColor px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-1 disabled:opacity-40"
              >
                {selected.tokenApproved ? 'Suspend account' : 'Restore account'}
              </button>

              {selected.id !== admin.id && (
                <>
                  <p className="mb-2 text-xs text-bolt-elements-textTertiary">
                    Deleting removes the account and everything it owns — chats, projects, balances. This cannot be
                    undone. Type <span className="font-mono text-bolt-elements-textPrimary">{selected.email}</span> to
                    confirm.
                  </p>
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    className="mb-2 w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary"
                  />
                  <button
                    disabled={busy || deleteConfirm !== selected.email}
                    onClick={async () => {
                      if (
                        await runAction(
                          { action: 'delete', userId: selected.id, confirmEmail: deleteConfirm },
                          'Account deleted'
                        )
                      ) {
                        setSelected(null);
                      }
                    }}
                    className="w-full rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete account
                  </button>
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </LandingAppChrome>
  );
}
