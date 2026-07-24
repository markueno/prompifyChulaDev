import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { optionalAuth } from '~/lib/auth';
import { createScopedLogger } from '~/utils/logger';
import type { BillingInterval } from '~/lib/billing/plans';
import { getPlan } from '~/lib/billing/plans';
import {
  isStripeConfigured,
  getAppUrl,
  createCustomer,
  createSubscriptionCheckout,
  createTopUpCheckout,
  resolvePriceId,
  resolveTopUpPriceId,
} from '~/lib/billing/stripe.server';
import { getStripeCustomerIdForCompany, setStripeCustomerIdForCompany } from '~/lib/billing/billing-db.server';
import { getActiveCompanyId } from '~/lib/workspace.server';

const logger = createScopedLogger('api.billing.checkout');

interface CheckoutBody {
  tierId?: string;
  interval?: BillingInterval;
  pack?: 'topup';
  companyId?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!isStripeConfigured()) {
    return json({ error: 'Billing is not configured. Set STRIPE_SECRET_KEY.' }, { status: 503 });
  }

  const user = await optionalAuth(request, context);

  if (!user?.id) {
    return json({ error: 'You must be signed in to subscribe.' }, { status: 401 });
  }

  let body: CheckoutBody;

  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return json({ error: 'Invalid request body.' }, { status: 400 });
  }

  try {
    // The workspace being billed (explicit, else the active workspace).
    const companyId = body.companyId || (await getActiveCompanyId(request, user));

    // Reuse the workspace's Stripe customer or create one and persist it.
    let customerId = await getStripeCustomerIdForCompany(companyId);

    if (!customerId) {
      const customer = await createCustomer({ email: user.email, userId: user.id, companyId });
      customerId = customer.id;
      await setStripeCustomerIdForCompany(companyId, user.id, customerId);
    }

    const successUrl = `${getAppUrl()}/app/pricing?status=success`;
    const cancelUrl = `${getAppUrl()}/app/pricing?status=canceled`;

    if (body.pack === 'topup') {
      const priceId = resolveTopUpPriceId();

      if (!priceId) {
        return json({ error: 'Top-up pack price is not configured.' }, { status: 400 });
      }

      const session = await createTopUpCheckout({
        customerId,
        priceId,
        userId: user.id,
        companyId,
        successUrl,
        cancelUrl,
      });

      return json({ url: session.url });
    }

    const interval: BillingInterval = body.interval === 'year' ? 'year' : 'month';
    const plan = body.tierId ? getPlan(body.tierId) : undefined;

    if (!plan || plan.priceCents === 0) {
      return json({ error: 'Unknown or non-purchasable plan.' }, { status: 400 });
    }

    const priceId = resolvePriceId(plan.tierId, interval);

    if (!priceId) {
      return json({ error: `No Stripe price configured for ${plan.displayName} (${interval}).` }, { status: 400 });
    }

    const session = await createSubscriptionCheckout({
      customerId,
      priceId,
      userId: user.id,
      companyId,
      tierId: plan.tierId,
      successUrl,
      cancelUrl,
    });

    return json({ url: session.url });
  } catch (e: any) {
    logger.error('Checkout session creation failed', e);
    return json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
  }
}
