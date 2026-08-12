/**
 * Brand context for the caller's active workspace.
 *
 * GET    /api/workspace-context            — load it
 * POST   /api/workspace-context { content, sourceUrl?, ifAbsent? }
 *                                          — save; ifAbsent only writes when none exists yet,
 *                                            which is how a browser's old localStorage copy is
 *                                            migrated up without clobbering a newer team edit
 * DELETE /api/workspace-context            — remove it
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getActiveCompanyId } from '~/lib/workspace.server';
import {
  getBrandContext,
  saveBrandContext,
  deleteBrandContext,
  MAX_BRAND_CONTEXT_CHARS,
} from '~/lib/brand-context.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.workspace-context');

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);

  try {
    const companyId = await getActiveCompanyId(request, user);
    const brand = await getBrandContext(companyId);

    return json({ context: brand?.content ?? '', sourceUrl: brand?.sourceUrl ?? null });
  } catch (error) {
    logger.error('Failed to load workspace context', error);
    return json({ error: 'Failed to load context' }, { status: 500 });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  const method = request.method.toUpperCase();

  try {
    const companyId = await getActiveCompanyId(request, user);

    if (method === 'DELETE') {
      await deleteBrandContext(companyId);
      return json({ success: true });
    }

    if (method !== 'POST') {
      return json({ error: `Method ${method} not allowed` }, { status: 405 });
    }

    const body = (await request.json()) as { content?: string; sourceUrl?: string; ifAbsent?: boolean };
    const content = (body.content ?? '').trim();

    if (!content) {
      return json({ error: 'content is required' }, { status: 400 });
    }

    if (content.length > MAX_BRAND_CONTEXT_CHARS) {
      return json(
        { error: `Context is too long (max ${MAX_BRAND_CONTEXT_CHARS.toLocaleString()} characters)` },
        { status: 400 }
      );
    }

    /*
     * Migration path: a browser pushing up its old localStorage copy must not overwrite a context
     * a teammate has since written for this workspace.
     */
    if (body.ifAbsent) {
      const existing = await getBrandContext(companyId);

      if (existing?.content) {
        return json({ success: true, skipped: true });
      }
    }

    await saveBrandContext({ companyId, content, sourceUrl: body.sourceUrl ?? null, userId: user.id });

    return json({ success: true });
  } catch (error) {
    logger.error('Failed to save workspace context', error);
    return json({ error: 'Failed to save context' }, { status: 500 });
  }
}
