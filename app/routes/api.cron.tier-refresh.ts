import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { refreshFreeTierAllocations } from '~/lib/billing/free-tier-refresh.server';

/*
 * POST /api/cron/tier-refresh            — DRY RUN (default): reports what WOULD be granted.
 * POST /api/cron/tier-refresh?apply=true — real run: re-grants the free allocation to every
 *                                          free-tier workspace whose period has lapsed.
 *
 * The free tier's stand-in for Stripe's `invoice.paid`: paid plans are re-granted by the webhook,
 * free plans have no invoice and would otherwise expire once and never come back. Guarded by
 * CRON_SECRET, same pattern as api.cron.gc / api.cron.sleep-check. Dry-run-first because this
 * mints tokens — verify the counts look sane before switching the cron to ?apply=true.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const cronSecret = (context?.cloudflare as any)?.env?.CRON_SECRET ?? process.env.CRON_SECRET;

  const authHeader = request.headers.get('Authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  process.env.DATABASE_URL = (context?.cloudflare as any)?.env?.DATABASE_URL ?? process.env.DATABASE_URL;

  const url = new URL(request.url);
  const apply = url.searchParams.get('apply') === 'true';
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined;

  try {
    const result = await refreshFreeTierAllocations({ dryRun: !apply, limit });

    console.log(
      `[tier-refresh] ${result.mode}: due=${result.due} refreshed=${result.refreshed} ` +
        `carried=${result.carriedTokens} forfeited=${result.forfeitedTokens} ` +
        `warned=${result.warned} failed=${result.failed} more=${result.more}`
    );

    return json(result);
  } catch (error) {
    console.error('Cron tier-refresh error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
