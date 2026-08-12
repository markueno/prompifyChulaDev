# Stripe — setup and go-live

Billing is **already built**. `app/lib/billing/stripe.server.ts` is a dependency-free Stripe client
(there is no `stripe` package to install), with checkout, the billing portal, webhook signature
verification, company-scoped subscriptions, token grants and top-ups. Tiers are seeded in
`schema.sql` with ids matching `app/lib/billing/plans.ts`.

What follows is configuration, not construction.

> Billing stays inert until `STRIPE_SECRET_KEY` is set — `/api/billing/checkout` returns 503 and
> the pricing page says billing isn't configured. Nothing breaks by leaving it unset.

## Naming

| Boss sent | What the code reads | Why |
|---|---|---|
| `STRIPE_PRICE_PRO_MONTHLY` | `STRIPE_PRICE_BUILDER_MONTHLY` | Same plan. Builder is the $8/mo tier (`plans.ts`), matching "Price for Builder 8 USD". Six other tiers already follow the `STRIPE_PRICE_<TIER>_<INTERVAL>` convention, so the env var is renamed rather than the code. |
| `STRIPE_PUBLISHABLE_KEY` | *(unused)* | Checkout is a server-side redirect. No client-side Stripe key exists anywhere in the app. |

## Secrets

Live keys go **only** into prod's `/root/prompifyChulaDev/.env`. Never into the repo, a commit
message, or a doc — `details/security/SECURITY_NOW.md` CRIT-2 is an open finding about secrets
already in this repo's git history. `.env.example` carries the names with empty values only.

---

## Part A — prove it in test mode (no real money)

### A1. Stripe dashboard, test mode
1. Toggle **Test mode** on.
2. Product → **Builder**, recurring **$8/month** → copy the Price ID (`price_...`).
3. Developers → API keys → copy the **test** secret key (`sk_test_...`).

### A2. Local env
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_BUILDER_MONTHLY=price_...
APP_URL=http://localhost:5173
```

### A3. Webhook forwarding
```bash
stripe login
stripe listen --forward-to localhost:5173/api/billing/webhook
```
Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`, then restart the app. This secret is
**different in test mode and live mode** — swapping keys later without swapping this fails every
webhook with a signature error.

### A4. Buy it
Sign in → `/app/pricing` → Builder → card `4242 4242 4242 4242`, any future expiry, any CVC.

### A5. Assert against the database, not the Stripe UI
```sql
SELECT company_id, tier_id, status, stripe_subscription_id
FROM subscriptions WHERE company_id = 'cmp_personal_<userId>';
-- expect: tier_builder / active / sub_...

SELECT source, tokens_allocated, tokens_used, effective_end
FROM token_balances WHERE company_id = 'cmp_personal_<userId>' ORDER BY created_at DESC;
-- expect a 'tier' row with 1000000 tokens
```
The `stripe listen` terminal should show `checkout.session.completed` and `invoice.paid` both
returning 200. A 400 there means the signature check failed — almost always a stale
`STRIPE_WEBHOOK_SECRET`.

### A6. Cancellation
In the dashboard, cancel the test subscription. `customer.subscription.deleted` should drop the
account back to `tier_trial` and expire the tier balance (top-ups survive by design).

### A7. Portal
`/api/billing/portal` should open Stripe's hosted portal for the customer.

---

## Part B — go live

1. Stripe dashboard **live mode**: recreate the Builder product/price, copy the live `price_...`.
2. Developers → Webhooks → **Add endpoint**: `https://www.prompify.com/api/billing/webhook`.
   Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy its signing secret —
   this is the **live** `STRIPE_WEBHOOK_SECRET`.
3. Add to prod `.env` (see `DEPLOY.md` for the deploy procedure):
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...        # from step 2, NOT the stripe-listen one
   STRIPE_PRICE_BUILDER_MONTHLY=price_...  # live-mode price id, NOT the test one
   ```
4. Redeploy the app container.
5. Do exactly one real $8 purchase, run the A5 queries against prod, then refund it in Stripe.
6. Confirm the endpoint shows 200s in Developers → Webhooks → your endpoint.

## Adding the rest of the plans

No code change — the other tiers only need their env vars set:
`STRIPE_PRICE_INNOVATOR_MONTHLY`, `_TEAM_`, `_BUSINESS_`, `_SCALE_` (each with a `_MONTHLY` and
optional `_ANNUAL`), plus `STRIPE_PRICE_TOPUP_1M` for the one-off top-up pack. A tier with no
price id set simply can't be purchased.

## If something goes wrong

| Symptom | Cause |
|---|---|
| Checkout returns 503 | `STRIPE_SECRET_KEY` not set in the running container |
| "Plan is not available" | The tier's `STRIPE_PRICE_*` env var is empty or has a test id while in live mode |
| Webhook 400 | `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint sending the event |
| Payment succeeds, no tokens | Webhook never arrived — check the endpoint is publicly reachable and returns 200 |
| Tokens granted twice | Shouldn't happen: grants are idempotent on the Stripe invoice id |
