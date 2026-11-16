/**
 * POST /api/client-trace — receives the builder tab's flight-recorder events
 * (app/lib/diagnostics/clientTrace.ts) and writes them to the app log.
 *
 * Body: { path: string, events: [{ t: number, type: string, detail?: string }] }
 *
 * Read them back with:
 *   docker logs --since 1h -t prompify-app 2>&1 | grep client-trace
 *
 * The events are event names, durations and short labels only. Everything is length-capped and
 * stripped of line breaks before it is logged, so a caller cannot forge extra log lines.
 */
import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { isAuthDisabled, optionalAuth } from '~/lib/auth';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('client-trace');

const MAX_BODY_BYTES = 64_000;
const MAX_EVENTS = 200;

const clean = (value: unknown, max: number) =>
  String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, max);

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  const user = await optionalAuth(request, context);

  if (!user?.id && !isAuthDisabled(context)) {
    return new Response(null, { status: 401 });
  }

  const raw = await request.text();

  if (raw.length > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body: { path?: unknown; events?: unknown };

  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const who = clean(user?.id ?? 'anon', 40);
  const path = clean(body.path, 120);

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue;
    }

    const { t, type, detail } = event as { t?: unknown; type?: unknown; detail?: unknown };
    const at = typeof t === 'number' && Number.isFinite(t) ? new Date(t).toISOString().slice(11, 23) : '?';

    logger.info(`${at} user=${who} ${path} | ${clean(type, 60)}${detail ? ` | ${clean(detail, 300)}` : ''}`);
  }

  return new Response(null, { status: 204 });
}
