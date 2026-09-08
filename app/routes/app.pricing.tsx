import { json, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useFetcher, useLoaderData, useSearchParams } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import { Menu } from '~/components/sidebar/Menu.client';
import { SafeBoundary } from '~/components/ui/SafeBoundary';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByCompanyId, getTokenBalanceRemainingForCompany } from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { isStripeConfigured, resolvePriceId } from '~/lib/billing/stripe.server';
import {
  PAID_PLANS,
  FREE_TIER_ID,
  TRIAL_PROMPT_LIMIT,
  type BillingInterval,
  type Plan,
  type PlanSegment,
  formatPrice,
  formatTokens,
} from '~/lib/billing/plans';
import { getTrialStatusForCompany } from '~/lib/billing/billing-db.server';
import landingStyles from '~/styles/landing.css?url';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = isAuthDisabled(context) ? getMockAdminUser() : await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);

  const [sub, balance, trial] = await Promise.all([
    getSubscriptionByCompanyId(companyId),
    getTokenBalanceRemainingForCompany(companyId, user.id),
    getTrialStatusForCompany(companyId),
  ]);

  /*
   * A tier can only be bought if its Stripe Price ID env var is actually set. Without this the
   * cards all look purchasable the moment STRIPE_SECRET_KEY exists, and clicking an unconfigured
   * one fails at checkout with "Plan is not available" — which is exactly what happens while
   * rolling the plans out one at a time.
   */
  const purchasableTierIds = PAID_PLANS.filter(
    p => resolvePriceId(p.tierId, 'month') || resolvePriceId(p.tierId, 'year')
  ).map(p => p.tierId);

  const currentTierId = (sub?.tier_id as string) ?? FREE_TIER_ID;
  const currentInterval = (sub?.billing_interval as 'month' | 'year' | null) ?? null;

  return json({
    /*
     * Header renders its whole right-hand toolbar behind `{user && …}` and reads it from
     * useLoaderData. Without this key the workspace switcher, notification bell and account
     * menu silently disappeared on this page only.
     */
    user,
    /* Only purchasable plans are listed — the trial is what you are on, never something you buy. */
    plans: PAID_PLANS,
    currentTierId,
    currentInterval,
    subscriptionStatus: (sub?.status as string) ?? null,
    hasStripeCustomer: Boolean(sub?.stripe_customer_id),
    balance,
    onTrial: currentTierId === FREE_TIER_ID,
    trialPromptsLeft: Math.max(0, TRIAL_PROMPT_LIMIT - (trial?.promptsUsed ?? 0)),
    stripeConfigured: isStripeConfigured(),
    purchasableTierIds,
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
  { title: 'Pricing — Prompify' },
  { name: 'description', content: 'Subscribe to keep building. Token-based plans with monthly or annual billing.' },
];

type CheckoutResponse = { url?: string; error?: string };

function PlanCard({
  plan,
  interval,
  isCurrent,
  disabled,
  /** True only for the card whose button was actually clicked. */
  pending,
  /** False when this tier has no Stripe Price ID configured yet. */
  purchasable,
  onSubscribe,
}: {
  plan: Plan;
  interval: BillingInterval;
  isCurrent: boolean;
  disabled: boolean;
  pending: boolean;
  purchasable: boolean;
  onSubscribe: (plan: Plan) => void;
}) {
  const priceCents = interval === 'year' ? plan.priceAnnualPerMonthCents : plan.priceCents;
  const billedNote = interval === 'year' ? `billed ${formatPrice(plan.priceAnnualCents)}/yr` : 'billed monthly';

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        plan.popular
          ? 'border-bolt-elements-item-contentAccent bg-bolt-elements-background-depth-1'
          : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/80'
      }`}
    >
      {plan.popular ? (
        <span className="absolute -top-3 left-6 rounded-full bg-bolt-elements-item-contentAccent px-3 py-0.5 text-xs font-semibold text-white">
          Most popular
        </span>
      ) : null}

      <h3 className="text-lg font-semibold text-bolt-elements-textPrimary">{plan.displayName}</h3>

      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-3xl font-bold text-bolt-elements-textPrimary">{formatPrice(priceCents)}</span>
        <span className="text-sm text-bolt-elements-textSecondary">/mo</span>
      </div>
      <p className="mt-1 text-xs text-bolt-elements-textSecondary">{billedNote}</p>

      <p className="mt-4 text-sm font-medium text-bolt-elements-textPrimary">
        {formatTokens(plan.tokens)} tokens / month
      </p>

      <ul className="mt-4 flex-1 space-y-2">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-bolt-elements-textSecondary">
            <span className="i-ph:check-circle-duotone mt-0.5 text-bolt-elements-item-contentAccent" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={isCurrent || disabled || !purchasable}
        onClick={() => onSubscribe(plan)}
        title={!isCurrent && !purchasable ? 'This plan has no Stripe price configured yet' : undefined}
        className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
          isCurrent || !purchasable
            ? 'cursor-default border border-bolt-elements-borderColor text-bolt-elements-textSecondary'
            : `bg-bolt-elements-item-contentAccent text-white hover:opacity-90 ${pending ? 'opacity-50' : ''}`
        }`}
      >
        {isCurrent ? 'Current plan' : pending ? 'Redirecting…' : purchasable ? 'Subscribe' : 'Coming soon'}
      </button>
    </div>
  );
}

export default function Pricing() {
  const {
    plans,
    currentTierId,
    currentInterval,
    balance,
    onTrial,
    trialPromptsLeft,
    stripeConfigured,
    hasStripeCustomer,
    purchasableTierIds,
  } = useLoaderData<typeof loader>();
  const [interval, setBillingInterval] = useState<BillingInterval>('month');

  /*
   * Which audience's plans to show. Defaults to the segment the current plan belongs to, so an
   * existing Business customer doesn't land on a page that omits the plan they are paying for.
   */
  const [segment, setSegment] = useState<PlanSegment>(
    () => plans.find(p => p.tierId === currentTierId)?.segment ?? 'user'
  );

  const visiblePlans = plans.filter(p => p.segment === segment);

  /*
   * Which plan's button was actually clicked. Without this the single `busy` flag disabled every
   * card at once and `disabled:opacity-50` dimmed all of them, so one click looked like every
   * Subscribe button had been pressed together.
   */
  const [pendingTierId, setPendingTierId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const checkout = useFetcher<CheckoutResponse>();
  const portal = useFetcher<CheckoutResponse>();

  // Show a banner once after returning from Stripe Checkout.
  useEffect(() => {
    const status = searchParams.get('status');

    if (status === 'success') {
      toast.success('Payment received — your tokens will appear within a few seconds.');
    } else if (status === 'canceled') {
      toast.info('Checkout canceled. No charge was made.');
    }
  }, [searchParams]);

  // Redirect to Stripe when a session url comes back; surface errors as toasts.
  useEffect(() => {
    if (checkout.data?.url) {
      window.location.href = checkout.data.url;
    } else if (checkout.data?.error) {
      // Clear the pending card, or its button stays "Redirecting…" forever after a failed checkout.
      setPendingTierId(null);
      toast.error(checkout.data.error);
    }
  }, [checkout.data]);

  useEffect(() => {
    if (portal.data?.url) {
      window.location.href = portal.data.url;
    } else if (portal.data?.error) {
      toast.error(portal.data.error);
    }
  }, [portal.data]);

  const busy = checkout.state !== 'idle' || portal.state !== 'idle';

  const subscribe = (plan: Plan) => {
    setPendingTierId(plan.tierId);
    checkout.submit(
      { tierId: plan.tierId, interval },
      { method: 'post', action: '/api/billing/checkout', encType: 'application/json' }
    );
  };

  const openPortal = () => {
    portal.submit({}, { method: 'post', action: '/api/billing/portal', encType: 'application/json' });
  };

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
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">Plans &amp; billing</h1>
            {/* Trial accounts are metered in prompts, paid ones in tokens — say whichever is true. */}
            {onTrial ? (
              <p className="mt-1 text-bolt-elements-textSecondary">
                You&apos;re on the free trial with{' '}
                <span className="font-semibold text-bolt-elements-textPrimary">
                  {trialPromptsLeft} of {TRIAL_PROMPT_LIMIT} prompts
                </span>{' '}
                left. Choose a plan to keep building once they&apos;re used.
              </p>
            ) : (
              <p className="mt-1 text-bolt-elements-textSecondary">
                Token-based pricing for the app builder. You have{' '}
                <span className="font-semibold text-bolt-elements-textPrimary">{balance.toLocaleString()} tokens</span>{' '}
                remaining. When you hit zero, the next prompt is blocked until your plan renews.
              </p>
            )}
          </div>

          {!stripeConfigured ? (
            <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
              Billing is in setup mode — <code>STRIPE_SECRET_KEY</code> is not configured yet, so checkout is disabled.
            </div>
          ) : null}

          {/* Billing interval on the left, audience on the right — two independent filters on one line. */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-1">
              <button
                type="button"
                onClick={() => setBillingInterval('month')}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  interval === 'month'
                    ? 'bg-bolt-elements-item-contentAccent text-white'
                    : 'text-bolt-elements-textSecondary'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingInterval('year')}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  interval === 'year'
                    ? 'bg-bolt-elements-item-contentAccent text-white'
                    : 'text-bolt-elements-textSecondary'
                }`}
              >
                Annual <span className="text-xs opacity-80">(2 months free)</span>
              </button>
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-1">
              <button
                type="button"
                onClick={() => setSegment('user')}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  segment === 'user'
                    ? 'bg-bolt-elements-item-contentAccent text-white'
                    : 'text-bolt-elements-textSecondary'
                }`}
              >
                User
              </button>
              <button
                type="button"
                onClick={() => setSegment('enterprise')}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  segment === 'enterprise'
                    ? 'bg-bolt-elements-item-contentAccent text-white'
                    : 'text-bolt-elements-textSecondary'
                }`}
              >
                Enterprise
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePlans.map(plan => (
              <PlanCard
                key={plan.tierId}
                plan={plan}
                interval={interval}
                isCurrent={plan.tierId === currentTierId && (!currentInterval || currentInterval === interval)}
                disabled={!stripeConfigured || busy}
                pending={pendingTierId === plan.tierId}
                purchasable={purchasableTierIds.includes(plan.tierId)}
                onSubscribe={subscribe}
              />
            ))}
          </div>

          {/* Only for existing customers — there is nothing to manage before the first purchase. */}
          {hasStripeCustomer ? (
            <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/80 p-6 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-base font-semibold text-bolt-elements-textPrimary">Your subscription</h3>
                <p className="mt-1 text-sm text-bolt-elements-textSecondary">
                  Update your card, download invoices, or cancel — all handled by Stripe.
                </p>
              </div>
              <button
                type="button"
                onClick={openPortal}
                disabled={!stripeConfigured || busy}
                className="rounded-lg border border-bolt-elements-borderColor px-4 py-2.5 text-sm font-semibold text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 disabled:opacity-50"
              >
                Manage billing
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </LandingAppChrome>
  );
}
