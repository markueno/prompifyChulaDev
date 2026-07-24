import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { optionalAuth } from '~/lib/auth';
import { createScopedLogger } from '~/utils/logger';
import { isStripeConfigured, getAppUrl, createBillingPortalSession } from '~/lib/billing/stripe.server';
import { getStripeCustomerIdForCompany } from '~/lib/billing/billing-db.server';
import { getActiveCompanyId } from '~/lib/workspace.server';

const logger = createScopedLogger('api.billing.portal');

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!isStripeConfigured()) {
    return json({ error: 'Billing is not configured.' }, { status: 503 });
  }

  const user = await optionalAuth(request, context);

  if (!user?.id) {
    return json({ error: 'You must be signed in.' }, { status: 401 });
  }

  try {
    const companyId = await getActiveCompanyId(request, user);
    const customerId = await getStripeCustomerIdForCompany(companyId);

    if (!customerId) {
      return json({ error: 'No billing account found. Subscribe to a plan first.' }, { status: 400 });
    }

    const session = await createBillingPortalSession({
      customerId,
      returnUrl: `${getAppUrl()}/app/pricing`,
    });

    return json({ url: session.url });
  } catch (e: any) {
    logger.error('Billing portal session creation failed', e);
    return json({ error: 'Could not open the billing portal. Please try again.' }, { status: 500 });
  }
}
