import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { markInactiveAppsSleeping } from '~/lib/app-lifecycle';

export async function action({ request, context }: ActionFunctionArgs) {
  const cronSecret = (context?.cloudflare as any)?.env?.CRON_SECRET ?? process.env.CRON_SECRET;

  const authHeader = request.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const slept = await markInactiveAppsSleeping(15);
    return json({ success: true, slept });
  } catch (error) {
    console.error('Cron sleep-check error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
