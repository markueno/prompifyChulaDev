import {
  json,
  type LinksFunction,
  type MetaFunction,
  type LoaderFunctionArgs,
} from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import { Header } from '~/components/header/Header';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getProjectOverview, getSubscriptionByUserId } from '~/lib/database';
import landingStyles from '~/styles/landing.css?url';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    const overview = await getProjectOverview(mockUser.id, mockUser.isModerator);
    return json({ user: mockUser, overview });
  }
  const user = await requireAuth(request, context);
  const [sub, overview] = await Promise.all([
    getSubscriptionByUserId(user.id),
    getProjectOverview(user.id, user.isModerator),
  ]);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };
  return json({ user: userWithTier, overview });
}

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap' },
  { rel: 'stylesheet', href: landingStyles },
];

export const meta: MetaFunction = () => [
  { title: 'Overview — Prompify' },
  { name: 'description', content: 'Project health, recent runs, error rate, and usage.' },
];

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/80 p-4 backdrop-blur-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-bolt-elements-textPrimary">{value}</p>
      {hint ? <p className="mt-2 text-sm text-bolt-elements-textSecondary">{hint}</p> : null}
    </div>
  );
}

export default function AppOverview() {
  const { overview } = useLoaderData<typeof loader>();

  const errorDisplay =
    overview.errorRatePercent === null
      ? '—'
      : `${overview.errorRatePercent}%`;
  const errorHint =
    overview.errorRatePercent === null
      ? 'No LLM runs recorded this week, or failure events are not logged yet.'
      : `Based on failure-tagged activity vs token_usage rows (7 days).`;

  return (
    <LandingAppChrome>
      <div className="landing-app-chrome flex min-h-0 w-full flex-1 flex-col">
        <Header />
        <main className="mx-auto w-full max-w-5xl flex-1 overflow-auto px-5 py-8">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">Overview</h1>
              <p className="mt-1 text-bolt-elements-textSecondary">
                Project health, recent runs, error signals, and token usage (rolling 7 days where noted).
              </p>
            </div>
            <Link
              to="/app"
              className="rounded-lg border border-bolt-elements-borderColor px-4 py-2 text-sm font-medium text-bolt-elements-textPrimary transition-colors hover:bg-bolt-elements-background-depth-2"
            >
              Back to app
            </Link>
          </div>

          <div
            className={`mb-8 rounded-xl border p-4 ${
              overview.healthStatus === 'attention'
                ? 'border-amber-500/50 bg-amber-500/10'
                : 'border-emerald-500/40 bg-emerald-500/10'
            }`}
          >
            <p className="text-sm font-semibold text-bolt-elements-textPrimary">
              Project health: {overview.healthStatus === 'healthy' ? 'Healthy' : 'Needs attention'}
            </p>
            {overview.healthReasons.length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-sm text-bolt-elements-textSecondary">
                {overview.healthReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-bolt-elements-textSecondary">
                No critical signals from balance or logged failures this week.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Projects" value={String(overview.projectCount)} />
            <StatCard
              label="Active projects (7d)"
              value={String(overview.activeProjectsLast7Days)}
              hint="Updated in the last 7 days."
            />
            <StatCard
              label="LLM runs (7d)"
              value={String(overview.runsLast7Days)}
              hint="Rows in token usage for your account."
            />
            <StatCard label="Error rate (7d)" value={errorDisplay} hint={errorHint} />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Tokens used (7d)"
              value={overview.tokensLast7Days.toLocaleString()}
              hint="Sum of prompt + completion tokens billed to your usage."
            />
            <StatCard
              label="Token balance remaining"
              value={overview.tokenBalanceRemaining.toLocaleString()}
              hint="From active token_balances grants."
            />
          </div>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">Recent runs</h2>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">
              Latest recorded LLM completions (newest first).
            </p>
            {overview.recentRuns.length === 0 ? (
              <p className="mt-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/60 p-6 text-bolt-elements-textSecondary">
                No usage yet. Open a project and send a prompt to see runs here.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-bolt-elements-borderColor rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/60">
                {overview.recentRuns.map((run, idx) => {
                  const chatPath = `/chat/${run.chatUrlId || run.chatId}`;
                  const when = new Date(run.at);
                  return (
                    <li key={`${run.chatId}-${run.at}-${idx}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          to={chatPath}
                          className="font-medium text-accent hover:underline"
                        >
                          {run.projectTitle?.trim() || 'Untitled project'}
                        </Link>
                        <p className="truncate text-xs text-bolt-elements-textSecondary">
                          {when.toLocaleString()} · {run.totalTokens.toLocaleString()} tokens
                          {run.model ? ` · ${run.model}` : ''}
                          {run.provider ? ` (${run.provider})` : ''}
                        </p>
                      </div>
                      <Link
                        to={chatPath}
                        className="shrink-0 text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                      >
                        Open →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      </div>
    </LandingAppChrome>
  );
}
