import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { sendInactivityNudges } from '~/lib/engagement/inactivity.server';

/*
 * POST /api/cron/inactivity            — DRY RUN (default): reports who WOULD be emailed.
 * POST /api/cron/inactivity?apply=true — real run: emails accounts that have gone quiet.
 *
 * Win-back mail for accounts that stopped signing in, capped at MAX_INACTIVITY_NUDGES per lapse.
 * Guarded by CRON_SECRET, same pattern as api.cron.gc. Dry-run-first
 * because this mails real people — check the addresses and day counts look sane before switching
 * the cron to ?apply=true. Unlike the token jobs it changes no account state, so a bad run costs
 * sender reputation rather than data.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const cronSecret = (context?.cloudflare as any)?.env?.CRON_SECRET ?? process.env.CRON_SECRET;

  const authHeader = request.headers.get('Authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cfEnv = (context?.cloudflare as any)?.env;

  process.env.DATABASE_URL = cfEnv?.DATABASE_URL ?? process.env.DATABASE_URL;

  // The mail transport reads these at send time; a cron request carries no other route to them.
  process.env.RESEND_API_KEY = cfEnv?.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
  process.env.FROM_EMAIL = cfEnv?.FROM_EMAIL ?? process.env.FROM_EMAIL;
  process.env.APP_URL = cfEnv?.APP_URL ?? process.env.APP_URL;

  const url = new URL(request.url);
  const apply = url.searchParams.get('apply') === 'true';
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined;

  try {
    const result = await sendInactivityNudges({ dryRun: !apply, limit });

    console.log(
      `[inactivity] ${result.mode}: due=${result.due} sent=${result.sent} ` +
        `failed=${result.failed} more=${result.more}`
    );

    return json(result);
  } catch (error) {
    console.error('Cron inactivity error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
