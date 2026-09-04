/**
 * Billing plan catalog — the single source of truth for subscription tiers.
 * Safe to import on the client (no secrets): it only holds prices,
 * token allocations, and the *names* of the env vars that store the Stripe Price IDs.
 *
 * Token allocations here MUST match the seed in `subscription_tiers`
 * (see database-postgresql.ts) so the UI, checkout, and grant logic agree.
 */

export type BillingInterval = 'month' | 'year';

/**
 * Which audience a plan is pitched at. The pricing page shows one segment at a time, because a
 * solo builder scanning six cards has to work out which three are not for them before they can
 * compare anything.
 */
export type PlanSegment = 'user' | 'enterprise';

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
  /** Pricing-page grouping. The trial has none — it is never shown as a card. */
  segment?: PlanSegment;
  popular?: boolean;
  features: string[];
  /** Env var holding the Stripe Price ID for the monthly plan. */
  stripePriceEnvMonthly?: string;
  /** Env var holding the Stripe Price ID for the annual plan. */
  stripePriceEnvAnnual?: string;
}

/** Tier granted on signup / after a paid subscription is canceled. */
export const FREE_TIER_ID = 'tier_trial';

/**
 * Prompts a workspace gets on the free trial, for the lifetime of the workspace — not per month.
 *
 * The trial is metered in prompts rather than tokens because it is a demonstration, not an
 * allowance: three prompts is a thing someone can picture spending before they sign up, whereas
 * "150,000 tokens" is only legible after you have already used some. Counted per workspace, which
 * is how every other billing limit here is scoped.
 */
export const TRIAL_PROMPT_LIMIT = 3;

export const PLANS: Plan[] = [
  /*
   * The trial. Deliberately has no `segment` — it is never rendered as a purchasable card, it is
   * what an account is on before it buys anything. Kept in the catalog because `tier_trial` is a
   * real tier id on subscriptions rows and getPlan() must resolve it.
   */
  {
    tierId: 'tier_trial',
    name: 'trial',
    displayName: 'Free trial',
    priceCents: 0,
    priceAnnualCents: 0,
    tokens: 150_000,
    seats: 1,
    features: [`${TRIAL_PROMPT_LIMIT} prompts to try it out`, 'No card required'],
  },
  {
    tierId: 'tier_builder',
    segment: 'user',
    name: 'builder',
    displayName: 'Builder',
    priceCents: 800,
    priceAnnualCents: 8000,
    tokens: 1_000_000,
    seats: 1,
    popular: true,
    features: ['1M tokens / month', 'Solo hobby projects', 'Email support'],
    stripePriceEnvMonthly: 'STRIPE_PRICE_BUILDER_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_BUILDER_ANNUAL',
  },
  {
    tierId: 'tier_innovator',
    segment: 'user',
    name: 'innovator',
    displayName: 'Innovator',
    priceCents: 1900,
    priceAnnualCents: 19000,
    tokens: 2_500_000,
    seats: 1,
    features: ['2.5M tokens / month', 'For active solo builders', 'Priority email support'],
    stripePriceEnvMonthly: 'STRIPE_PRICE_INNOVATOR_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_INNOVATOR_ANNUAL',
  },
  /*
   * Team tiers = shared workspace pool + seats. Token amounts are PLACEHOLDERS —
   * tune them to your margin target (see docs: ~$4/1M blended; aim ~70-75% gross).
   */
  {
    tierId: 'tier_team',
    segment: 'user',
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
    segment: 'enterprise',
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
    segment: 'enterprise',
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

export const PAID_PLANS = PLANS.filter(p => p.priceCents > 0);

/** Purchasable plans for one audience, in catalog order. */
export function plansForSegment(segment: PlanSegment): Plan[] {
  return PAID_PLANS.filter(p => p.segment === segment);
}

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
