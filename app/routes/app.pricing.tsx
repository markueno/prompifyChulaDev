import { json, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useFetcher, useLoaderData, useSearchParams } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import { Menu } from '~/components/sidebar/Menu.client';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByCompanyId, getTokenBalanceRemainingForCompany } from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { isStripeConfigured, resolvePriceId, resolveTopUpPriceId } from '~/lib/billing/stripe.server';
import { PLANS, TOPUP_PACK, type BillingInterval, type Plan, formatPrice, formatTokens } from '~/lib/billing/plans';
import landingStyles from '~/styles/landing.css?url';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = isAuthDisabled(context) ? getMockAdminUser() : await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);

  const [sub, balance] = await Promise.all([
    getSubscriptionByCompanyId(companyId),
    getTokenBalanceRemainingForCompany(companyId, user.id),
  ]);

  /*
   * A tier can only be bought if its Stripe Price ID env var is actually set. Without this the
   * cards all look purchasable the moment STRIPE_SECRET_KEY exists, and clicking an unconfigured
   * one fails at checkout with "Plan is not available" — which is exactly what happens while
   * rolling the plans out one at a time.
   */
  const purchasableTierIds = PLANS.filter(
    p => p.priceCents > 0 && (resolvePriceId(p.tierId, 'month') || resolvePriceId(p.tierId, 'year'))
  ).map(p => p.tierId);

  return json({
    /*
     * Header renders its whole right-hand toolbar behind `{user && …}` and reads it from
     * useLoaderData. Without this key the workspace switcher, notification bell and account
     * menu silently disappeared on this page only.
     */
    user,
    plans: PLANS,
    topup: TOPUP_PACK,
    currentTierId: (sub?.tier_id as string) ?? 'tier_trial',
    subscriptionStatus: (sub?.status as string) ?? null,
    hasStripeCustomer: Boolean(sub?.stripe_customer_id),
    balance,
    stripeConfigured: isStripeConfigured(),
    purchasableTierIds,
    topupAvailable: Boolean(resolveTopUpPriceId()),
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
  /** False when this tier has no Stripe Price ID configured yet. */
  purchasable,
  onSubscribe,
}: {
  plan: Plan;
  interval: BillingInterval;
  isCurrent: boolean;
  disabled: boolean;
  purchasable: boolean;
  onSubscribe: (plan: Plan) => void;
}) {
  const isFree = plan.priceCents === 0;
  const priceCents = interval === 'year' ? Math.round(plan.priceAnnualCents / 12) : plan.priceCents;
  const billedNote =
    isFree || interval === 'month'
      ? interval === 'month' && !isFree
        ? 'billed monthly'
        : ''
      : `billed ${formatPrice(plan.priceAnnualCents)}/yr`;

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
        {!isFree ? <span className="text-sm text-bolt-elements-textSecondary">/mo</span> : null}
      </div>
      {billedNote ? <p className="mt-1 text-xs text-bolt-elements-textSecondary">{billedNote}</p> : null}

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
        disabled={isFree || isCurrent || disabled || !purchasable}
        onClick={() => onSubscribe(plan)}
        title={!isFree && !isCurrent && !purchasable ? 'This plan has no Stripe price configured yet' : undefined}
        className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
          isCurrent || isFree || !purchasable
            ? 'cursor-default border border-bolt-elements-borderColor text-bolt-elements-textSecondary'
            : 'bg-bolt-elements-item-contentAccent text-white hover:opacity-90 disabled:opacity-50'
        }`}
      >
        {isCurrent ? 'Current plan' : isFree ? 'Included' : purchasable ? 'Subscribe' : 'Coming soon'}
      </button>
    </div>
  );
}

export default function Pricing() {
  const {
    plans,
    topup,
    currentTierId,
    balance,
    stripeConfigured,
    hasStripeCustomer,
    purchasableTierIds,
    topupAvailable,
  } = useLoaderData<typeof loader>();
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
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
    checkout.submit(
      { tierId: plan.tierId, interval },
      { method: 'post', action: '/api/billing/checkout', encType: 'application/json' }
    );
  };

  const buyTopUp = () => {
    checkout.submit(
      { pack: 'topup' },
      { method: 'post', action: '/api/billing/checkout', encType: 'application/json' }
    );
  };

  const openPortal = () => {
    portal.submit({}, { method: 'post', action: '/api/billing/portal', encType: 'application/json' });
  };

  return (
    <LandingAppChrome>
      <div className="landing-app-chrome flex min-h-0 w-full flex-1 flex-col">
        {/* Chat history sidebar — same hover-out drawer the chat page has. */}
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 overflow-auto px-5 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">Plans &amp; billing</h1>
            <p className="mt-1 text-bolt-elements-textSecondary">
              Token-based pricing for the app builder. You have{' '}
              <span className="font-semibold text-bolt-elements-textPrimary">{balance.toLocaleString()} tokens</span>{' '}
              remaining. When you hit zero, the next prompt is blocked until you upgrade or top up.
            </p>
          </div>

          {!stripeConfigured ? (
            <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
              Billing is in setup mode — <code>STRIPE_SECRET_KEY</code> is not configured yet, so checkout is disabled.
            </div>
          ) : null}

          <div className="mb-6 inline-flex items-center gap-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-1">
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

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map(plan => (
              <PlanCard
                key={plan.tierId}
                plan={plan}
                interval={interval}
                isCurrent={plan.tierId === currentTierId}
                disabled={!stripeConfigured || busy}
                purchasable={purchasableTierIds.includes(plan.tierId)}
                onSubscribe={subscribe}
              />
            ))}
          </div>

          <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/80 p-6 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-semibold text-bolt-elements-textPrimary">Need more tokens this month?</h3>
              <p className="mt-1 text-sm text-bolt-elements-textSecondary">
                Buy a one-off {formatTokens(topup.tokens)} top-up for {formatPrice(topup.priceCents)}. Top-ups never
                expire and are used after your monthly allotment.
              </p>
            </div>
            <div className="flex gap-3">
              {hasStripeCustomer ? (
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={!stripeConfigured || busy}
                  className="rounded-lg border border-bolt-elements-borderColor px-4 py-2.5 text-sm font-semibold text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 disabled:opacity-50"
                >
                  Manage billing
                </button>
              ) : null}
              <button
                type="button"
                onClick={buyTopUp}
                disabled={!stripeConfigured || !topupAvailable || busy}
                title={!topupAvailable ? 'The top-up pack has no Stripe price configured yet' : undefined}
                className="rounded-lg bg-bolt-elements-item-contentAccent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {topupAvailable ? 'Buy top-up' : 'Coming soon'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </LandingAppChrome>
  );
}
