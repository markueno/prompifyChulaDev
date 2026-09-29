/**
 * Settings page — accessible to ALL authenticated users ( *
 * Four sections:
 *   1. Account — update password (inline form, POST /api/auth/change-password)
 *   2. Billing — current plan + interval, "Manage billing" via Stripe Customer Portal
 *   3. Workspaces — active workspace info + invite-code management (admin only)
 *   4. Integrations — GitHub + Netlify (reuses existing connection components)
 */
import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Link, useLoaderData, useSubmit } from '@remix-run/react';
import { useState } from 'react';
import { requireAuth } from '~/lib/auth';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { getSubscriptionByCompanyId } from '~/lib/database';
import { getPlan } from '~/lib/billing/plans';
import { GithubConnection } from '~/components/@settings/tabs/connections/GithubConnection';
import { NetlifyConnection } from '~/components/@settings/tabs/connections/NetlifyConnection';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);

  const sub = await getSubscriptionByCompanyId(companyId);

  const tierId = (sub?.tier_id as string) ?? 'tier_trial';
  const plan = getPlan(tierId);
  const billingInterval = (sub?.billing_interval as 'month' | 'year' | null) ?? null;

  return json({
    user,
    planName: plan?.displayName ?? 'Free trial',
    billingInterval,
    subscriptionStatus: (sub?.status as string) ?? null,
    hasStripeCustomer: Boolean(sub?.stripe_customer_id),
  });
}

const FIELD_CLASS =
  'w-full rounded-lg border border-[#fed7aa]/60 dark:border-[#423322] bg-white dark:bg-[#221a10] ' +
  'px-3 py-2 text-sm text-[#231710] dark:text-[#f0e4d5] placeholder:text-[#231710]/40 ' +
  'dark:placeholder:text-[#c4b19a]/50 focus:border-[#f97316] focus:outline-none focus:ring-1 focus:ring-[#f97316]';

const LABEL_CLASS = 'block text-sm font-medium text-[#231710] dark:text-[#f0e4d5] mb-1.5';

/*
 * Frosted panels rather than tinted ones.
 *
 * These sections used to be bg-[#f0e4d5]/50 on a bg-[#f0e4d5] page — the page's own colour at half
 * strength over itself, which composites to very nearly the page again. With a border at /40 on
 * top of that, the whole page read as one flat beige sheet with a hairline on it, and nothing
 * looked divided from anything.
 *
 * A near-white translucent surface over the beige separates by LIGHTNESS, which survives at a
 * glance where a hue shift of a few percent does not, and the blur gives it the frosted look the
 * project list has. The border carries the brand orange properly instead of hinting at it.
 */
const SECTION_CLASS =
  'overflow-hidden rounded-2xl border border-white/50 dark:border-[#f97316]/20 ' +
  'bg-white/70 dark:bg-[#2d2014]/70 backdrop-blur-xl ' +
  'shadow-[0_4px_24px_rgba(35,23,16,0.12)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)]';

/** The header strip. Its rule is what actually divides a section's title from its controls. */
const SECTION_HEADER_CLASS =
  'flex items-start gap-3 border-b border-[#f97316]/20 dark:border-[#f97316]/15 ' +
  'bg-white/50 dark:bg-white/5 px-6 py-4';

const SECTION_BODY_CLASS = 'p-6';

/**
 * One settings block: an icon, a title, a line of explanation, then its controls below a rule.
 *
 * Extracted because all three sections repeated the same markup with slightly different spacing,
 * which is how they drifted apart in the first place.
 */
function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className={SECTION_CLASS}>
      <header className={SECTION_HEADER_CLASS}>
        <span className={`${icon} mt-0.5 shrink-0 text-xl text-[#f97316]`} aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="mt-1 text-sm text-[#231710]/60 dark:text-[#c4b19a]">{description}</p>
        </div>
      </header>
      <div className={SECTION_BODY_CLASS}>{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { user, planName, billingInterval, subscriptionStatus, hasStripeCustomer } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    setPasswordBusy(true);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setPasswordError(data.error || 'Failed to update password');

        return;
      }

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setPasswordError('Network error — please try again');
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleManageBilling = () => {
    submit(null, { method: 'post', action: '/api/billing/portal' });
  };

  return (
    /*
     * A deeper ground than the rest of the app, and a gradient rather than a flat fill.
     *
     * The panels are near-white, so how much they stand out is decided entirely by what sits
     * behind them: against the app's usual #f0e4d5 the contrast was slight even after the panels
     * stopped being the same colour as the page. Darkening the background is what makes them read
     * as raised, and it gives the blur something to work with down the length of the page rather
     * than only where the two washes fall.
     */
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#e2d0b9] via-[#d9c5ab] to-[#cfb99c] text-[#231710] dark:from-[#150e07] dark:via-[#120c06] dark:to-[#0d0804] dark:text-[#f0e4d5]">
      {/*
       * Two soft washes of brand colour behind the panels. Frosted glass only reads as frosted
       * when there is something behind it to blur — over a perfectly flat fill the backdrop-blur
       * has no effect at all and the panels just look like paler rectangles.
       */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#f97316]/15 blur-3xl dark:bg-[#f97316]/10" />
        <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-[#fed7aa]/50 blur-3xl dark:bg-[#f97316]/10" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-[#f97316]/10 blur-3xl dark:bg-[#f97316]/5" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 py-12">
        {/*
         * This page renders without the app chrome — no Header, no sidebar — so without this there
         * is no way back except the browser's own button.
         */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1">Settings</h1>
            <p className="text-sm text-[#231710]/60 dark:text-[#c4b19a]">
              Manage your account, billing, and integrations.
            </p>
          </div>
          <Link
            to="/app/"
            className="rounded-lg border border-white/60 dark:border-[#423322] bg-white/80 dark:bg-[#221a10] px-4 py-2 text-sm font-medium shadow-sm backdrop-blur-md transition-colors hover:bg-white dark:hover:bg-[#2a2016]"
          >
            Back to app
          </Link>
        </div>

        <div className="space-y-6">
          <SettingsSection
            icon="i-ph:user-circle"
            title="Account"
            description="Update your password. You'll need your current password to confirm."
          >
            <div className="mb-4">
              <label className={LABEL_CLASS}>Email</label>
              <input
                type="email"
                value={user?.email ?? ''}
                readOnly
                className={`${FIELD_CLASS} opacity-60 cursor-not-allowed`}
              />
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className={LABEL_CLASS}>Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  required
                  className={FIELD_CLASS}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className={FIELD_CLASS}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className={FIELD_CLASS}
                  autoComplete="new-password"
                />
              </div>

              {passwordError && <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
              {passwordSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">Password updated successfully.</p>
              )}

              <button
                type="submit"
                disabled={passwordBusy}
                className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea580c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {passwordBusy ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </SettingsSection>

          <SettingsSection
            icon="i-ph:credit-card"
            title="Billing"
            description="Manage your subscription, payment method, and invoices via Stripe."
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <p className="text-sm text-[#231710]/60 dark:text-[#c4b19a]">Current plan</p>
                <p className="text-lg font-semibold">
                  {planName}
                  {billingInterval && (
                    <span className="ml-2 text-sm font-normal text-[#231710]/60 dark:text-[#c4b19a]">
                      ({billingInterval === 'year' ? 'Annual' : 'Monthly'})
                    </span>
                  )}
                </p>
                {subscriptionStatus && subscriptionStatus !== 'active' && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">Status: {subscriptionStatus}</p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              {hasStripeCustomer && (
                <button
                  type="button"
                  onClick={handleManageBilling}
                  className="rounded-lg border border-[#fed7aa]/60 dark:border-[#423322] bg-white dark:bg-[#221a10] px-4 py-2 text-sm font-medium text-[#231710] dark:text-[#f0e4d5] hover:border-[#f97316] transition-colors"
                >
                  Manage billing
                </button>
              )}
              <a
                href="/app/pricing"
                className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea580c] transition-colors"
              >
                Change plan
              </a>
            </div>
          </SettingsSection>

          {/*
           * Workspace administration deliberately is not here. It lives at /app/workspace, reached
           * from the workspace switcher — this page is about your account, not about running a team.
           */}

          <SettingsSection
            icon="i-ph:plugs-connected"
            title="Integrations"
            description="Connect your GitHub and Netlify accounts to deploy your apps directly."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <GithubConnection />
              <NetlifyConnection />
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
