/**
 * Minimal, dependency-free Stripe client built on `fetch` + `crypto`.
 *
 * We intentionally avoid the official `stripe` SDK so billing works the same in
 * Node and edge runtimes and adds no install step. Only the handful of endpoints
 * we need (customers, checkout sessions, billing portal, subscriptions) plus
 * webhook signature verification are implemented.
 */
import crypto from 'crypto';
import { PLANS, type BillingInterval } from './plans';

const STRIPE_API = 'https://api.stripe.com/v1';

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  return key;
}

export function getAppUrl(): string {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/** Form-encode arbitrarily nested params the way Stripe expects (foo[bar][0]=baz). */
function encodeForm(value: unknown, prefix = ''): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, i) => encodeForm(item, `${prefix}[${i}]`));
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      encodeForm(v, prefix ? `${prefix}[${k}]` : k)
    );
  }

  return [`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`];
}

async function stripeRequest<T = any>(
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, unknown>
): Promise<T> {
  const encoded = params ? encodeForm(params).join('&') : '';
  const isGet = method === 'GET';
  const url = isGet && encoded ? `${STRIPE_API}${path}?${encoded}` : `${STRIPE_API}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: !isGet ? encoded : undefined,
  });

  const data = (await res.json()) as any;

  if (!res.ok) {
    const message = data?.error?.message || res.statusText;
    throw new Error(`Stripe ${method} ${path} failed: ${message}`);
  }

  return data as T;
}

export interface StripeCustomer {
  id: string;
}

export async function createCustomer(params: {
  email?: string;
  userId: string;
  companyId: string;
}): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>('POST', '/customers', {
    email: params.email,
    metadata: { userId: params.userId, companyId: params.companyId },
  });
}

export interface CheckoutSession {
  id: string;
  url: string | null;
}

export async function createSubscriptionCheckout(params: {
  customerId: string;
  priceId: string;
  userId: string;
  companyId: string;
  tierId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: params.customerId,
    client_reference_id: params.companyId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [{ price: params.priceId, quantity: 1 }],
    /*
     * Mirror the workspace onto the subscription so webhooks can map back regardless
     * of event ordering.
     */
    subscription_data: { metadata: { userId: params.userId, companyId: params.companyId, tierId: params.tierId } },
    metadata: { userId: params.userId, companyId: params.companyId, tierId: params.tierId, kind: 'subscription' },
    allow_promotion_codes: true,
  });
}

export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>('POST', '/billing_portal/sessions', {
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

export async function retrieveSubscription(subscriptionId: string): Promise<any> {
  return stripeRequest('GET', `/subscriptions/${subscriptionId}`);
}

/**
 * Resolve a Stripe Price ID for a plan tier + interval from env vars.
 * Returns null when the price isn't configured.
 */
export function resolvePriceId(tierId: string, interval: BillingInterval): string | null {
  const plan = PLANS.find(p => p.tierId === tierId);

  if (!plan) {
    return null;
  }

  const envName = interval === 'year' ? plan.stripePriceEnvAnnual : plan.stripePriceEnvMonthly;

  return (envName && process.env[envName]) || null;
}

/** Reverse map: a Stripe Price ID -> our tierId. Used by the webhook. */
export function tierIdForPriceId(priceId: string): string | null {
  for (const plan of PLANS) {
    const monthly = plan.stripePriceEnvMonthly && process.env[plan.stripePriceEnvMonthly];
    const annual = plan.stripePriceEnvAnnual && process.env[plan.stripePriceEnvAnnual];

    if (priceId === monthly || priceId === annual) {
      return plan.tierId;
    }
  }

  return null;
}

/**
 * Verify a Stripe webhook signature (scheme v1) without the SDK.
 * Mirrors Stripe's constructEvent: signed_payload = `${t}.${rawBody}`.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts: Record<string, string> = {};

  for (const segment of signatureHeader.split(',')) {
    const idx = segment.indexOf('=');

    if (idx > 0) {
      parts[segment.slice(0, idx).trim()] = segment.slice(idx + 1).trim();
    }
  }

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');

  let signatureMatches = false;

  try {
    signatureMatches = crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }

  if (!signatureMatches) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  return Math.abs(now - Number(timestamp)) <= toleranceSeconds;
}
