/**
 * Settings page — accessible to ALL authenticated users (not just moderators).
 *
 * Three sections:
 *   1. Account — update password (inline form, POST /api/auth/change-password)
 *   2. Billing — current plan + interval, "Manage billing" via Stripe Customer Portal
 *   3. Integrations — GitHub + Netlify (reuses existing connection components)
 *
 * The moderator-only ControlPanel (debug, event-logs, task-manager, etc.) remains
 * separate — this page is for the account/billing/integrations every user needs.
 */
import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData, useSubmit } from '@remix-run/react';
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

const SECTION_CLASS =
  'rounded-xl border border-[#fed7aa]/40 dark:border-[#423322] bg-[#f0e4d5]/50 dark:bg-[#2d2014]/50 p-6';

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
    <div className="min-h-screen bg-[#f0e4d5] dark:bg-[#1a120a] text-[#231710] dark:text-[#f0e4d5]">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-sm text-[#231710]/60 dark:text-[#c4b19a] mb-8">
          Manage your account, billing, and integrations.
        </p>

        {/* ── Account ─────────────────────────────────────────────── */}
        <section className={`${SECTION_CLASS} mb-6`}>
          <h2 className="text-lg font-semibold mb-1">Account</h2>
          <p className="text-sm text-[#231710]/60 dark:text-[#c4b19a] mb-4">
            Update your password. You'll need your current password to confirm.
          </p>

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
        </section>

        {/* ── Billing ─────────────────────────────────────────────── */}
        <section className={`${SECTION_CLASS} mb-6`}>
          <h2 className="text-lg font-semibold mb-1">Billing</h2>
          <p className="text-sm text-[#231710]/60 dark:text-[#c4b19a] mb-4">
            Manage your subscription, payment method, and invoices via Stripe.
          </p>

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
        </section>

        {/* ── Integrations ────────────────────────────────────────── */}
        <section className={SECTION_CLASS}>
          <h2 className="text-lg font-semibold mb-1">Integrations</h2>
          <p className="text-sm text-[#231710]/60 dark:text-[#c4b19a] mb-4">
            Connect your GitHub and Netlify accounts to deploy your apps directly.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <GithubConnection />
            <NetlifyConnection />
          </div>
        </section>
      </div>
    </div>
  );
}
