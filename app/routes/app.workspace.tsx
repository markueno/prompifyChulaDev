/**
 * Workspace settings — Overview, Users and Tokens.
 *
 * Owners and admins only, and only for a real workspace: a personal workspace has one member and
 * no seats to administer, so the page would be an empty shell. Reached from the workspace
 * switcher rather than the main navbar, which is about a user's own work. The checks here are the
 * ones that matter — hiding an entry point is not access control.
 *
 * The tab lives in the URL so a particular view can be linked to and survives a reload.
 */
import { json, redirect, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Link, useLoaderData, useRevalidator, useSearchParams } from '@remix-run/react';
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
  getCompanyDailyUsage,
  getCompanyProjectUsage,
  getTokenBalanceRemainingForCompany,
  getWorkspaceTokenCap,
} from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { canManageMembers, consumesSeat, isWorkspaceOwner } from '~/lib/workspace-roles';
import { classNames } from '~/utils/classNames';
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

  if (!canManageMembers(member?.role)) {
    return redirect('/app/overview');
  }

  const [members, seats, companies, invitations, daily, projects, remaining, tokenCap] = await Promise.all([
    getCompanyMemberUsage(companyId, USAGE_WINDOW_DAYS),
    getCompanySeats(companyId),
    getUserCompanies(user.id),
    listCompanyInvitations(companyId),
    getCompanyDailyUsage(companyId, USAGE_WINDOW_DAYS),
    getCompanyProjectUsage(companyId, USAGE_WINDOW_DAYS),
    getTokenBalanceRemainingForCompany(companyId, user.id),
    getWorkspaceTokenCap(companyId, user.id),
  ]);

  const active = companies.find((c: any) => c.id === companyId);

  return json({
    user,
    companyId,
    companyName: active?.name ?? 'Workspace',
    companySlug: active?.slug ?? null,
    isOwner: isWorkspaceOwner(member?.role),
    members,
    seats,
    invitations,
    daily,
    projects,
    remaining,
    tokenCap,
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

/** 'developer' still appears on rows written before the developer→editor migration. */
const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  developer: 'Editor',
  viewer: 'Viewer',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={
        role === 'owner'
          ? 'text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400'
          : 'text-xs px-2 py-0.5 rounded bg-gray-500/15 text-gray-600 dark:text-gray-400'
      }
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'tokens', label: 'Tokens' },
] as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-bolt-elements-textPrimary">{value}</p>
      {hint ? <p className="mt-1 text-xs text-bolt-elements-textSecondary">{hint}</p> : null}
    </div>
  );
}

/** Horizontal bar, sized against the largest value in its own list. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;

  return (
    <div className="h-1.5 w-full rounded-full bg-bolt-elements-background-depth-3">
      <div className="h-1.5 rounded-full bg-[#f97316]" style={{ width: `${pct}%` }} />
    </div>
  );
}

function OverviewTab({
  members,
  daily,
  remaining,
  seats,
  seatsUsed,
  windowDays,
}: {
  members: any[];
  daily: { day: string; tokens: number }[];
  remaining: number;
  seats: number;
  seatsUsed: number;
  windowDays: number;
}) {
  /*
   * "Least active" only counts people who have actually run something. Naming whoever spent zero
   * would just surface the newest member every time, which says nothing about activity.
   */
  const spenders = members.filter(m => m.tokens_spent > 0);
  const most = spenders.length ? spenders.reduce((a, b) => (b.tokens_spent > a.tokens_spent ? b : a)) : null;
  const least = spenders.length ? spenders.reduce((a, b) => (b.tokens_spent < a.tokens_spent ? b : a)) : null;
  const busiest = daily.length ? daily.reduce((a, b) => (b.tokens > a.tokens ? b : a)) : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Stat label="Members" value={String(members.length)} hint={`${seatsUsed} of ${seats} seats — viewers are free`} />
      <Stat label="Tokens remaining" value={remaining.toLocaleString()} hint="Shared across this owner's workspaces" />
      <Stat
        label={`Busiest day (${windowDays}d)`}
        value={busiest ? busiest.tokens.toLocaleString() : '—'}
        hint={busiest ? new Date(busiest.day).toLocaleDateString() : 'No usage recorded yet'}
      />
      <Stat
        label="Most active"
        value={most ? most.email : '—'}
        hint={most ? `${most.tokens_spent.toLocaleString()} tokens` : 'Nobody has run anything yet'}
      />
      <Stat
        label="Least active"
        value={least && spenders.length > 1 ? least.email : '—'}
        hint={
          spenders.length > 1 ? `${least!.tokens_spent.toLocaleString()} tokens` : 'Needs at least two people building'
        }
      />
    </div>
  );
}

/**
 * The cap control. Owner-only to change, but the figure is shown to admins too — an admin who can
 * see that the workspace is near its ceiling can ask for more, which is better than discovering it
 * when a prompt is refused.
 */
function TokenCapCard({
  companyId,
  cap,
  used,
  canEdit,
}: {
  companyId: string;
  cap: number | null;
  used: number;
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const [draft, setDraft] = useState(cap === null ? '' : String(cap));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = draft.trim();

    // An empty box means "no limit", which is how the cap is removed.
    const next = trimmed === '' ? null : Number(trimmed);

    if (next !== null && (!Number.isInteger(next) || next <= 0)) {
      setError('Enter a whole number above zero, or leave it empty for no limit.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, tokenCap: next }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Could not save the limit');
      }

      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the limit');
    } finally {
      setSaving(false);
    }
  };

  const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

  return (
    <section className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5">
      <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Token limit</h2>
      <p className="mt-1 text-xs text-bolt-elements-textSecondary">
        Tokens are pooled across every workspace you own. A limit reserves the rest of the pool for your other
        workspaces — it does not buy more. Leave it empty for no limit.
      </p>

      {cap !== null && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs text-bolt-elements-textSecondary">
            <span>
              {used.toLocaleString()} of {cap.toLocaleString()} used this period
            </span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bolt-elements-background-depth-3">
            <div
              className={classNames('h-full rounded-full', pct >= 100 ? 'bg-red-500' : 'bg-orange-500')}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
        </div>
      )}

      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="No limit"
            aria-label="Token limit for this workspace"
            className="w-40 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save limit'}
          </button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      ) : (
        <p className="mt-4 text-xs text-bolt-elements-textSecondary">
          {cap === null ? 'No limit set.' : 'Only the workspace owner can change this.'}
        </p>
      )}
    </section>
  );
}

function TokensTab({
  companyId,
  daily,
  projects,
  remaining,
  tokenCap,
  isOwner,
  windowDays,
}: {
  companyId: string;
  daily: { day: string; tokens: number }[];
  projects: { chatId: string; name: string; urlId: string | null; projectId: string | null; tokens: number }[];
  remaining: number;
  tokenCap: { cap: number | null; used: number; periodStart: string | null };
  isOwner: boolean;
  windowDays: number;
}) {
  const maxDay = daily.reduce((m, d) => Math.max(m, d.tokens), 0);
  const maxProject = projects.reduce((m, p) => Math.max(m, p.tokens), 0);
  const spent = daily.reduce((sum, d) => sum + d.tokens, 0);

  /*
   * What this workspace can still spend: the smaller of the shared pool and what its own cap
   * leaves. Showing the pool alone would promise tokens a capped workspace cannot actually use.
   */
  const capRoom = tokenCap.cap === null ? null : Math.max(0, tokenCap.cap - tokenCap.used);
  const available = capRoom === null ? remaining : Math.min(remaining, capRoom);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Available"
          value={available.toLocaleString()}
          hint={
            capRoom !== null && capRoom < remaining
              ? "Limited by this workspace's limit"
              : "Drawn from the owner's pool"
          }
        />
        <Stat label={`Spent (${windowDays}d)`} value={spent.toLocaleString()} hint="This workspace only" />
      </div>

      <TokenCapCard companyId={companyId} cap={tokenCap.cap} used={tokenCap.used} canEdit={isOwner} />

      <section className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5">
        <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Spend per day</h2>
        {daily.length === 0 ? (
          <p className="mt-3 text-sm text-bolt-elements-textSecondary">No usage in the last {windowDays} days.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {daily.map(d => (
              <li key={d.day} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-bolt-elements-textSecondary">
                  {new Date(d.day).toLocaleDateString()}
                </span>
                <Bar value={d.tokens} max={maxDay} />
                <span className="w-24 shrink-0 text-right text-xs text-bolt-elements-textSecondary">
                  {d.tokens.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5">
        <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Spend per project</h2>
        {projects.length === 0 ? (
          <p className="mt-3 text-sm text-bolt-elements-textSecondary">No usage in the last {windowDays} days.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {projects.map(p => (
              <li key={p.chatId} className="flex items-center gap-3 text-sm">
                <span className="w-48 shrink-0 truncate text-bolt-elements-textPrimary" title={p.name}>
                  {p.name}
                </span>
                <Bar value={p.tokens} max={maxProject} />
                <span className="w-24 shrink-0 text-right text-xs text-bolt-elements-textSecondary">
                  {p.tokens.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function WorkspacePage() {
  const {
    companyId,
    companyName,
    members,
    seats,
    invitations,
    daily,
    projects,
    remaining,
    tokenCap,
    isOwner,
    windowDays,
    user,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');

  const requested = searchParams.get('tab');
  const tab = TABS.some(t => t.id === requested) ? (requested as string) : 'overview';

  /*
   * Seats are spent by roles that can build, so viewers do not count — the same rule the server
   * applies when admitting someone. Counting every member here would show a workspace as full
   * while invitations were still succeeding.
   */
  const seatsUsed = members.filter((m: any) => consumesSeat(m.role)).length;
  const seatsLeft = seats - seatsUsed;

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
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">{companyName}</h1>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">
              {seatsUsed} of {seats} seats used · {totalSpent.toLocaleString()} tokens spent in the last {windowDays}{' '}
              days.
            </p>
          </div>

          {/* Tab in the URL so a view can be linked to and survives a reload. */}
          <nav className="mb-8 flex gap-1 border-b border-bolt-elements-borderColor">
            {TABS.map(t => (
              <Link
                key={t.id}
                to={`/app/workspace?tab=${t.id}`}
                className={classNames('-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors', {
                  'border-[#f97316] text-bolt-elements-textPrimary': tab === t.id,
                  'border-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary':
                    tab !== t.id,
                })}
              >
                {t.label}
              </Link>
            ))}
          </nav>

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

          {tab === 'overview' ? (
            <OverviewTab
              members={members}
              daily={daily}
              remaining={remaining}
              seats={seats}
              seatsUsed={seatsUsed}
              windowDays={windowDays}
            />
          ) : null}

          {tab === 'tokens' ? (
            <TokensTab
              companyId={companyId}
              daily={daily}
              projects={projects}
              remaining={remaining}
              tokenCap={tokenCap}
              isOwner={isOwner}
              windowDays={windowDays}
            />
          ) : null}

          <section
            hidden={tab !== 'users'}
            className="mb-8 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-5"
          >
            <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Invite someone</h2>
            <p className="mt-0.5 text-xs text-bolt-elements-textSecondary">
              {seatsLeft > 0
                ? `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left on your plan. Viewers are free.`
                : 'Every seat on your plan is taken — upgrade to invite more builders. You can still add viewers.'}
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
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
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

          <section
            hidden={tab !== 'users'}
            className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 overflow-hidden"
          >
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
                    const isOwnerRow = m.role === 'owner';
                    const isAdminRow = m.role === 'admin';

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
                          {/*
                           * The owner's row carries no actions: there is exactly one per workspace,
                           * so it can be neither demoted nor removed, and promoting someone else
                           * would create a second. The server refuses all three regardless.
                           */}
                          {isSelf || isOwnerRow ? null : (
                            <div className="flex justify-end gap-2">
                              <button
                                disabled={busy === m.user_id}
                                onClick={() =>
                                  mutate(
                                    { userId: m.user_id, role: isAdminRow ? 'editor' : 'admin' },
                                    'PATCH',
                                    m.user_id
                                  )
                                }
                                className="rounded-md border border-bolt-elements-borderColor px-2.5 py-1 text-xs text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 disabled:opacity-50"
                              >
                                {isAdminRow ? 'Make editor' : 'Make admin'}
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
