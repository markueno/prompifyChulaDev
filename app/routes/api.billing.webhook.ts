import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { FREE_TIER_ID, getPlan } from '~/lib/billing/plans';
import { verifyStripeSignature, tierIdForPriceId, retrieveSubscription } from '~/lib/billing/stripe.server';
import {
  grantTierTokens,
  recordPayment,
  upsertSubscription,
  expireActiveTierBalances,
  setCompanySeats,
  getCompanyIdByStripeCustomerId,
  getCompanyOwnerUserId,
  setStripeCustomerIdForCompany,
} from '~/lib/billing/billing-db.server';

const logger = createScopedLogger('api.billing.webhook');

function unixToDate(seconds?: number | null): Date | null {
  return typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000) : null;
}

/**
 * Resolve the workspace + a valid owner user id for a Stripe customer/subscription.
 * Falls back to subscription metadata (event ordering) and persists the mapping.
 */
async function resolveCompany(
  customerId?: string | null,
  subscriptionId?: string | null
): Promise<{ companyId: string; userId: string } | null> {
  if (customerId) {
    const companyId = await getCompanyIdByStripeCustomerId(customerId);

    if (companyId) {
      const userId = await getCompanyOwnerUserId(companyId);

      if (userId) {
        return { companyId, userId };
      }
    }
  }

  if (subscriptionId) {
    try {
      const sub = await retrieveSubscription(subscriptionId);
      const companyId = sub?.metadata?.companyId as string | undefined;

      if (companyId) {
        const userId = (sub?.metadata?.userId as string) || (await getCompanyOwnerUserId(companyId));

        if (userId) {
          if (customerId) {
            await setStripeCustomerIdForCompany(companyId, userId, customerId);
          }

          return { companyId, userId };
        }
      }
    } catch (e) {
      logger.error('Failed to retrieve subscription for workspace mapping', e);
    }
  }

  return null;
}

async function handleCheckoutCompleted(session: any): Promise<void> {
  const companyId = (session.metadata?.companyId as string) || (session.client_reference_id as string) || null;
  const customerId = (session.customer as string) || null;

  if (!companyId) {
    logger.error('Checkout completed without a companyId', { sessionId: session.id });
    return;
  }

  const userId = (session.metadata?.userId as string) || (await getCompanyOwnerUserId(companyId));

  if (!userId) {
    logger.error('Checkout completed without a resolvable user', { sessionId: session.id, companyId });
    return;
  }

  /*
   * One-off `payment` sessions were the top-up pack, which has been removed. Historical top-up
   * balances still exist and still spend; nothing new can be bought, so a payment-mode session
   * arriving here now is not something this endpoint knows how to honour.
   */
  if (session.mode === 'payment') {
    logger.warn(`Ignoring unexpected one-off payment session ${session.id} for workspace ${companyId}`);
    return;
  }

  if (session.mode === 'subscription') {
    // Persist the customer<->workspace mapping + tier now; tokens are granted on invoice.paid.
    await upsertSubscription({
      companyId,
      userId,
      tierId: (session.metadata?.tierId as string) || FREE_TIER_ID,
      status: 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: (session.subscription as string) || null,
    });
  }
}

async function handleInvoicePaid(invoice: any): Promise<void> {
  const customerId = (invoice.customer as string) || null;

  // `invoice.subscription` on older API versions; `invoice.parent...` on 2025+ versions.
  const subscriptionId =
    (invoice.subscription as string) ||
    (invoice.parent?.subscription_details?.subscription as string) ||
    (invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription as string) ||
    null;

  // Only subscription invoices grant tier tokens (top-ups are handled at checkout).
  if (!subscriptionId) {
    return;
  }

  const resolved = await resolveCompany(customerId, subscriptionId);

  if (!resolved) {
    // Throw so Stripe retries later, by which time the workspace mapping should exist.
    throw new Error(`Could not map invoice ${invoice.id} to a workspace`);
  }

  const { companyId, userId } = resolved;
  const lines: any[] = invoice.lines?.data ?? [];
  const line = lines.find(l => l?.price?.recurring) ?? lines[0];
  const priceId = line?.price?.id as string | undefined;

  let tierId = priceId ? tierIdForPriceId(priceId) : null;

  if (!tierId) {
    try {
      const sub = await retrieveSubscription(subscriptionId);
      tierId = (sub?.metadata?.tierId as string) || null;
    } catch {
      /* handled below */
    }
  }

  if (!tierId) {
    logger.error(`Invoice ${invoice.id}: could not determine tier from price ${priceId}`);
    return;
  }

  const plan = getPlan(tierId);

  if (!plan) {
    logger.error(`Invoice ${invoice.id}: unknown tier ${tierId}`);
    return;
  }

  const periodStart = unixToDate(line?.period?.start) ?? unixToDate(invoice.period_start) ?? new Date();
  const periodEnd =
    unixToDate(line?.period?.end) ??
    unixToDate(invoice.period_end) ??
    new Date(periodStart.getTime() + 31 * 24 * 60 * 60 * 1000);

  await upsertSubscription({
    companyId,
    userId,
    tierId,
    status: 'active',
    periodStart,
    periodEnd,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  });
  await setCompanySeats(companyId, plan.seats);
  await grantTierTokens({
    idempotencyKey: invoice.id,
    companyId,
    userId,
    subscriptionId,
    tokens: plan.tokens,
    periodStart,
    periodEnd,
  });

  /*
   * History only — the tokens above are what the customer actually receives. A failure to log the
   * payment must not fail the webhook, or Stripe retries an invoice whose tokens were already
   * granted and the idempotency key silently swallows the re-grant.
   */
  try {
    await recordPayment({
      userId,
      amountCents: Number(invoice.amount_paid ?? invoice.total ?? 0),
      currency: (invoice.currency as string) || 'usd',
      stripeInvoiceId: invoice.id as string,
      stripeSubscriptionId: subscriptionId,
      tokens: plan.tokens,
    });
  } catch (e) {
    logger.error(`Failed to record payment for invoice ${invoice.id}`, e);
  }

  logger.info(`Granted ${plan.tokens} ${plan.displayName} tokens to workspace ${companyId} (invoice ${invoice.id})`);
}

async function handleSubscriptionUpdated(subscription: any): Promise<void> {
  const customerId = (subscription.customer as string) || null;
  const resolved = await resolveCompany(customerId, subscription.id);

  if (!resolved) {
    return;
  }

  const { companyId, userId } = resolved;
  const priceId = subscription.items?.data?.[0]?.price?.id as string | undefined;
  const tierId = (priceId && tierIdForPriceId(priceId)) || (subscription.metadata?.tierId as string) || FREE_TIER_ID;
  const plan = getPlan(tierId);

  await upsertSubscription({
    companyId,
    userId,
    tierId,
    status: subscription.status || 'active',
    periodStart: unixToDate(subscription.current_period_start),
    periodEnd: unixToDate(subscription.current_period_end),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
  });

  if (plan) {
    await setCompanySeats(companyId, plan.seats);
  }
}

async function handleSubscriptionDeleted(subscription: any): Promise<void> {
  const customerId = (subscription.customer as string) || null;
  const resolved = await resolveCompany(customerId, subscription.id);

  if (!resolved) {
    return;
  }

  const { companyId, userId } = resolved;

  // Downgrade to free, drop to 1 seat, and expire still-active tier tokens (top-ups kept).
  await upsertSubscription({
    companyId,
    userId,
    tierId: FREE_TIER_ID,
    status: 'canceled',
    stripeCustomerId: customerId,
  });
  await setCompanySeats(companyId, 1);
  await expireActiveTierBalances(companyId);
  logger.info(`Subscription canceled — downgraded workspace ${companyId} to free`);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured');
    return json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!verifyStripeSignature(rawBody, signature, secret)) {
    logger.error('Invalid Stripe webhook signature');
    return json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: any;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  } catch (e: any) {
    // Non-2xx tells Stripe to retry (used for transient/ordering issues above).
    logger.error(`Error handling ${event.type}`, e);
    return json({ error: 'Handler error' }, { status: 500 });
  }

  return json({ received: true });
}
