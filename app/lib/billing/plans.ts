/**
 * Billing plan catalog — the single source of truth for subscription tiers and the
 * top-up pack. Safe to import on the client (no secrets): it only holds prices,
 * token allocations, and the *names* of the env vars that store the Stripe Price IDs.
 *
 * Token allocations here MUST match the seed in `subscription_tiers`
 * (see database-postgresql.ts) so the UI, checkout, and grant logic agree.
 */

export type BillingInterval = 'month' | 'year';

export interface Plan {
  /** Matches subscription_tiers.id and the value stored on subscriptions.tier_id. */
  tierId: string;
  name: string;
  displayName: string;
  /** Monthly price in cents (USD). 0 = free. */
  priceCents: number;
  /** Total annual price in cents (charged once per year). 0 = no annual option. */
  priceAnnualCents: number;
  /** Tokens granted at the start of each billing period. */
  tokens: number;
  /** Included seats (informational for now; seat enforcement is not yet implemented). */
  seats: number;
  popular?: boolean;
  features: string[];
  /** Env var holding the Stripe Price ID for the monthly plan. */
  stripePriceEnvMonthly?: string;
  /** Env var holding the Stripe Price ID for the annual plan. */
  stripePriceEnvAnnual?: string;
}

/** Tier granted on signup / after a paid subscription is canceled. */
export const FREE_TIER_ID = 'tier_trial';

export const PLANS: Plan[] = [
  {
    tierId: 'tier_trial',
    name: 'trial',
    displayName: 'Free',
    priceCents: 0,
    priceAnnualCents: 0,
    tokens: 150_000,
    seats: 1,
    features: ['150K tokens / month', 'A handful of prompts to evaluate', 'Community support'],
  },
  {
    tierId: 'tier_builder',
    name: 'builder',
    displayName: 'Builder',
    priceCents: 800,
    priceAnnualCents: 8000,
    tokens: 1_000_000,
    seats: 1,
    popular: true,
    features: ['1M tokens / month', 'Solo hobby projects', 'Email support', 'Top-up packs available'],
    stripePriceEnvMonthly: 'STRIPE_PRICE_BUILDER_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_BUILDER_ANNUAL',
  },
  {
    tierId: 'tier_innovator',
    name: 'innovator',
    displayName: 'Innovator',
    priceCents: 1900,
    priceAnnualCents: 19000,
    tokens: 2_500_000,
    seats: 1,
    features: ['2.5M tokens / month', 'For active solo builders', 'Priority email support', 'Top-up packs available'],
    stripePriceEnvMonthly: 'STRIPE_PRICE_INNOVATOR_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_INNOVATOR_ANNUAL',
  },
  /*
   * Team tiers = shared workspace pool + seats. Token amounts are PLACEHOLDERS —
   * tune them to your margin target (see docs: ~$4/1M blended; aim ~70-75% gross).
   */
  {
    tierId: 'tier_team',
    name: 'team',
    displayName: 'Team',
    priceCents: 12900,
    priceAnnualCents: 129000,
    tokens: 18_000_000,
    seats: 5,
    features: ['Shared token pool', 'Up to 5 seats', 'For small teams', 'Priority email support'],
    stripePriceEnvMonthly: 'STRIPE_PRICE_TEAM_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_TEAM_ANNUAL',
  },
  {
    tierId: 'tier_business',
    name: 'business',
    displayName: 'Business',
    priceCents: 34900,
    priceAnnualCents: 349000,
    tokens: 50_000_000,
    seats: 10,
    features: ['Shared token pool', 'Up to 10 seats', 'For growing teams', 'Priority support'],
    stripePriceEnvMonthly: 'STRIPE_PRICE_BUSINESS_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_BUSINESS_ANNUAL',
  },
  {
    tierId: 'tier_scale',
    name: 'scale',
    displayName: 'Scale',
    priceCents: 74900,
    priceAnnualCents: 749000,
    tokens: 120_000_000,
    seats: 20,
    features: ['Shared token pool', 'Up to 20 seats', 'For large teams', 'Priority support + onboarding'],
    stripePriceEnvMonthly: 'STRIPE_PRICE_SCALE_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_SCALE_ANNUAL',
  },
];

/** One-off token pack any paid plan can buy when they run out mid-period. */
export const TOPUP_PACK = {
  id: 'topup_1m',
  displayName: '1M Token Top-up',
  tokens: 1_000_000,
  priceCents: 1000,
  stripePriceEnv: 'STRIPE_PRICE_TOPUP_1M',
};

export const PAID_PLANS = PLANS.filter(p => p.priceCents > 0);

export function getPlan(tierId: string): Plan | undefined {
  return PLANS.find(p => p.tierId === tierId);
}

/** Human-friendly token formatting, e.g. 1_500_000 -> "1.5M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }

  return String(tokens);
}

/** Price formatting in whole dollars, e.g. 1900 -> "$19". */
export function formatPrice(cents: number): string {
  if (cents === 0) {
    return 'Free';
  }

  const dollars = cents / 100;

  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
