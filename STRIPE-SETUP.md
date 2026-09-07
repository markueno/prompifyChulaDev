# Stripe — setup and go-live

Billing is **already built**. `app/lib/billing/stripe.server.ts` is a dependency-free Stripe client
(there is no `stripe` package to install), with checkout, the billing portal, webhook signature
verification, company-scoped subscriptions and token grants. Tiers are seeded in
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
account back to `tier_trial` and expire the tier balance (historical top-up balances survive by
design).

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

---

## Part C — turning on all six plans

Still no code change. Every tier resolves its price id from an env var at request time
(`resolvePriceId`, `stripe.server.ts:163`), so enabling a plan means setting its variable and
restarting the container. A tier with no price id set simply can't be purchased — the pricing page
hides it (`app.pricing.tsx:33`).

### C1. Sort the keys before touching the server

The keys arrive as a list of `price_...` strings. Two properties decide whether they work at all:

- **Mode.** Price ids are scoped to test or live mode. A `sk_live_` secret key with a test-mode
  `price_` id fails at checkout with a Stripe API error, not a graceful message. Confirm with the
  sender which mode each id belongs to — the id itself does not say.
- **Interval.** A price is created as monthly *or* yearly recurring; the same id can't serve both.
  `_MONTHLY` and `_ANNUAL` must come from two different Stripe prices on the same product.

Write the mapping down before you start, because Stripe's dashboard shows products, and the app
thinks in tiers:

| Stripe product | tierId | Monthly var | Annual var | plans.ts price |
|---|---|---|---|---|
| Builder | `tier_builder` | `STRIPE_PRICE_BUILDER_MONTHLY` | `STRIPE_PRICE_BUILDER_ANNUAL` | $8 / **$72** |
| Innovator | `tier_innovator` | `STRIPE_PRICE_INNOVATOR_MONTHLY` | `STRIPE_PRICE_INNOVATOR_ANNUAL` | $19 / **$192** |
| Team | `tier_team` | `STRIPE_PRICE_TEAM_MONTHLY` | `STRIPE_PRICE_TEAM_ANNUAL` | $129 / **$1,260** |
| Business | `tier_business` | `STRIPE_PRICE_BUSINESS_MONTHLY` | `STRIPE_PRICE_BUSINESS_ANNUAL` | $349 / **$3,480** |
| Scale | `tier_scale` | `STRIPE_PRICE_SCALE_MONTHLY` | `STRIPE_PRICE_SCALE_ANNUAL` | $749 / **$7,500** |
Free (`tier_trial`) has no Stripe price and must not get one — it is the 3-prompt trial granted
in-app at signup, and it is never rendered as a purchasable card.

The customer-facing top-up pack was removed; `STRIPE_PRICE_TOPUP_1M` is read by nothing. Delete it
from prod `.env` if it is still set. Admins can still grant tokens manually from the admin console.

### C2. Check the Stripe amounts against `plans.ts`

`plans.ts` drives what the customer *sees*; Stripe drives what they are *charged*. Nothing
reconciles the two, so a mismatch means the pricing page advertises one number and the card is
debited another. For each price id, open it in Stripe and confirm the amount and interval match the
table above. If the boss created them at different amounts, fix `plans.ts` (and the matching
`subscription_tiers` seed in `schema.sql:281-294`, which must stay in sync) rather than quietly
shipping the discrepancy.

The annual amounts are NOT a clean multiple of the monthly price. They are
`priceAnnualPerMonthCents × 12` — the headline per-month figure the card advertises under the
Annual toggle ($6, $16, $105, $290, $625), chosen to be printable rather than the $6.67 that a
10× annual total would produce.

**The Stripe annual price must equal the total in the table above.** `plans.spec.ts` enforces that
the card's own two numbers agree with each other, but nothing can check them against Stripe — if
they diverge, the page advertises one figure and the card is debited another.

### C3. Set the variables on prod

Live keys go only into prod's `/root/prompifyChulaDev/.env` — never the repo. The app service is
declared `env_file: '.env'` (`docker-compose.prod.yaml:72`), so every `STRIPE_*` name in that file
reaches the container automatically. **No compose edit is needed**, and adding them to the explicit
`environment:` list is unnecessary.

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BUILDER_MONTHLY=price_...
STRIPE_PRICE_BUILDER_ANNUAL=price_...
STRIPE_PRICE_INNOVATOR_MONTHLY=price_...
STRIPE_PRICE_INNOVATOR_ANNUAL=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
STRIPE_PRICE_TEAM_ANNUAL=price_...
STRIPE_PRICE_BUSINESS_MONTHLY=price_...
STRIPE_PRICE_BUSINESS_ANNUAL=price_...
STRIPE_PRICE_SCALE_MONTHLY=price_...
STRIPE_PRICE_SCALE_ANNUAL=price_...
APP_URL=https://www.prompify.com
```

Back the file up first (`cp .env .env.bak.$(date +%F)`) — it is the rollback.

**Set both intervals per tier, or neither.** The pricing page shows a plan when *either* interval
resolves, but the Annual toggle then sends `interval: 'year'` to checkout, which returns 400
*"No Stripe price configured for Team (year)"* (`api.billing.checkout.ts:94-96`). Monthly-only tiers
are a visible dead end for anyone who clicks Annual.

### C4. Webhook endpoint

One endpoint covers all plans; if Part B is done, it already exists and needs nothing. Otherwise:
Developers → Webhooks → Add endpoint → `https://www.prompify.com/api/billing/webhook`, subscribed to
`checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`,
`customer.subscription.updated`, `customer.subscription.deleted`. Its signing secret is the live
`STRIPE_WEBHOOK_SECRET` — not the one `stripe listen` prints.

Adding plans does not change the signing secret. Rotating the secret key does not either.

### C5. Restart and confirm the container actually sees them

```bash
cd /root/prompifyChulaDev
docker compose -f docker-compose.prod.yaml --profile production up -d app
docker compose -f docker-compose.prod.yaml exec app printenv | grep STRIPE_PRICE | sort
```

Expect ten lines with non-empty `price_` values. An env var edited in `.env` but missing here
means the container was restarted rather than recreated — `up -d` recreates it, `restart` does not.

### C6. Verify in the app

1. `/app/pricing` — the **User** toggle shows Builder, Innovator and Team; **Enterprise** shows
   Business and Scale. The free trial is not listed on either.
2. Flip the Monthly/Annual toggle — every tier keeps a working button on both settings.
3. Buy the cheapest plan for real ($8 Builder), then assert against the database, not the Stripe UI:

```sql
SELECT tier_id, status, stripe_subscription_id, current_period_end
FROM subscriptions WHERE company_id = 'cmp_personal_<userId>';
-- expect: tier_builder / active / sub_... / ~1 month out

SELECT source, tokens_allocated, effective_end
FROM token_balances WHERE company_id = 'cmp_personal_<userId>' ORDER BY created_at DESC LIMIT 3;
-- expect a 'tier' row of 1000000 alongside the original 150000 trial row

SELECT seats FROM companies WHERE id = 'cmp_personal_<userId>';   -- expect 1
```

Then refund it in Stripe. Refunding does **not** revoke granted tokens — that is deliberate, but it
means test purchases on the big tiers hand out real allocation. Test on Builder only.

4. Stripe → Developers → Webhooks → your endpoint: all deliveries 200.

### C7. Rollback

Restore `.env.bak.<date>` and re-run the `up -d app` from C5. Emptying a `STRIPE_PRICE_*` value
removes that plan from the pricing page without affecting anyone already subscribed to it —
existing subscriptions keep renewing through Stripe and keep granting tokens, because `invoice.paid`
falls back to the subscription's `tierId` metadata when the price id no longer maps
(`api.billing.webhook.ts:130-139`).

## If something goes wrong

| Symptom | Cause |
|---|---|
| Checkout returns 503 | `STRIPE_SECRET_KEY` not set in the running container |
| "Plan is not available" | The tier's `STRIPE_PRICE_*` env var is empty or has a test id while in live mode |
| Webhook 400 | `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint sending the event |
| Payment succeeds, no tokens | Webhook never arrived — check the endpoint is publicly reachable and returns 200 |
| Tokens granted twice | Shouldn't happen: grants are idempotent on the Stripe invoice id |
| "No Stripe price configured for X (year)" | That tier has `_MONTHLY` set but `_ANNUAL` empty — see C3 |
| A tier is missing from the pricing page | Neither of its price vars resolved in the running container — re-run the C5 `printenv` check |
| Tier is right but the token grant is wrong | `plans.ts` and the `subscription_tiers` seed disagree; grants read `plans.ts` |
| Checkout errors mentioning "No such price" | Test-mode price id with a live secret key, or vice versa (C1) |
