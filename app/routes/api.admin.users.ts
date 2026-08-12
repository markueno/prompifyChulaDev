/**
 * Platform admin API. Superadmin only — see requireSuperadmin(), which answers 404 rather than
 * 403 so the console's existence isn't advertised.
 *
 * GET  /api/admin/users?search=&limit=&offset=   — list users with billing + usage state
 * POST /api/admin/users  { action, userId, ... } — grantTokens | changeTier | setSuspended | delete
 *
 * Every mutation is written to user_activity so there is a trail of who changed what.
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireSuperadmin } from '~/lib/auth';
import { logUserActivity } from '~/lib/database';
import {
  listUsersForAdmin,
  getAdminUserEmail,
  adminGrantTokens,
  adminChangeTier,
  adminSetSuspended,
  adminDeleteUser,
  isSelf,
} from '~/lib/admin/admin-db.server';

/** Comping more than this in one action is almost certainly a typo (e.g. a stray zero). */
const MAX_GRANT_TOKENS = 100_000_000;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireSuperadmin(request, context);

  const url = new URL(request.url);
  const search = url.searchParams.get('search') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);

  try {
    const page = await listUsersForAdmin({
      search,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return json(page);
  } catch (error) {
    console.error('[api.admin.users] list failed:', error);
    return json({ error: 'Failed to load users' }, { status: 500 });
  }
}

interface AdminActionBody {
  action: 'grantTokens' | 'changeTier' | 'setSuspended' | 'delete';
  userId: string;
  tokens?: number;
  tierId?: string;
  suspended?: boolean;
  /** Must equal the target's email for `delete` — a deliberate speed bump. */
  confirmEmail?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const admin = await requireSuperadmin(request, context);

  if (request.method.toUpperCase() !== 'POST') {
    return json({ error: `Method ${request.method} not allowed` }, { status: 405 });
  }

  let body: AdminActionBody;

  try {
    body = (await request.json()) as AdminActionBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action: verb, userId } = body;

  if (!userId) {
    return json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    switch (verb) {
      case 'grantTokens': {
        const tokens = Number(body.tokens);

        if (!Number.isFinite(tokens) || tokens <= 0) {
          return json({ error: 'tokens must be a positive number' }, { status: 400 });
        }

        if (tokens > MAX_GRANT_TOKENS) {
          return json(
            { error: `Refusing to grant more than ${MAX_GRANT_TOKENS.toLocaleString()} tokens at once` },
            { status: 400 }
          );
        }

        await adminGrantTokens(userId, Math.floor(tokens), admin.id);
        await logUserActivity(admin.id, 'admin_grant_tokens', { targetUserId: userId, tokens });

        return json({ success: true });
      }

      case 'changeTier': {
        if (!body.tierId) {
          return json({ error: 'tierId is required' }, { status: 400 });
        }

        const result = await adminChangeTier(userId, body.tierId);

        if (!result.ok) {
          return json({ error: result.reason }, { status: 409 });
        }

        await logUserActivity(admin.id, 'admin_change_tier', { targetUserId: userId, tierId: body.tierId });

        return json({ success: true });
      }

      case 'setSuspended': {
        const suspended = Boolean(body.suspended);

        if (suspended && isSelf(admin.id, userId)) {
          return json({ error: 'You cannot suspend your own account' }, { status: 400 });
        }

        await adminSetSuspended(userId, suspended);
        await logUserActivity(admin.id, 'admin_set_suspended', { targetUserId: userId, suspended });

        return json({ success: true });
      }

      case 'delete': {
        if (isSelf(admin.id, userId)) {
          return json({ error: 'You cannot delete your own account' }, { status: 400 });
        }

        /*
         * The console asks the admin to type the target's email. Verify it here too — the check
         * is worthless if it only exists in the browser, and this is an irreversible cascade.
         */
        const targetEmail = await getAdminUserEmail(userId);

        if (!targetEmail) {
          return json({ error: 'Account not found' }, { status: 404 });
        }

        if (targetEmail !== body.confirmEmail) {
          return json({ error: 'Confirmation email does not match this account' }, { status: 400 });
        }

        await adminDeleteUser(userId);
        await logUserActivity(admin.id, 'admin_delete_user', { targetUserId: userId, email: targetEmail });

        return json({ success: true });
      }

      default:
        return json({ error: `Unknown action "${verb}"` }, { status: 400 });
    }
  } catch (error) {
    console.error(`[api.admin.users] ${verb} failed:`, error);
    return json({ error: 'Action failed' }, { status: 500 });
  }
}
