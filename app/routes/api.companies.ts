import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { isWorkspaceOwner } from '~/lib/workspace-roles';
import { getWorkspaceAllowance } from '~/lib/workspace-entitlements.server';
import {
  addAuditLog,
  archiveCompany,
  createCompany,
  getCompanyBySlug,
  getCompanyMember,
  getUserCompanies,
  updateCompany,
} from '~/lib/database';

export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const [companies, allowance] = await Promise.all([getUserCompanies(user.id), getWorkspaceAllowance(user.id)]);

    /*
     * The allowance rides along because the workspace switcher already calls this on every page
     * mount — a separate endpoint would double that traffic to answer three integers.
     */
    return json({ companies, allowance });
  } catch (error) {
    console.error('Error loading companies:', error);
    return json({ error: 'Failed to load companies' }, { status: 500 });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const method = request.method.toUpperCase();

    if (method === 'POST') {
      const { name, slug, githubOrg } = (await request.json()) as {
        name: string;
        slug: string;
        githubOrg?: string;
      };

      if (!name || !slug) {
        return json({ error: 'name and slug are required' }, { status: 400 });
      }

      if (!/^[a-z0-9-]+$/.test(slug)) {
        return json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' }, { status: 400 });
      }

      // Same entitlement gate as company.new.tsx — this route is open to any authenticated caller.
      const allowance = await getWorkspaceAllowance(user.id);

      if (!allowance.canCreate) {
        return json(
          {
            error:
              allowance.max === 0
                ? 'Creating workspaces requires an enterprise plan.'
                : `Your plan allows ${allowance.max} workspaces and you already have ${allowance.owned}.`,
            code: 'upgrade_required',
          },
          { status: 402 }
        );
      }

      const existing = await getCompanyBySlug(slug);

      if (existing) {
        return json({ error: 'A company with that slug already exists' }, { status: 409 });
      }

      const company = await createCompany(name, slug, user.id, githubOrg);

      if (!company) {
        return json({ error: 'Failed to create company' }, { status: 500 });
      }

      return json({ company }, { status: 201 });
    }

    if (method === 'PATCH') {
      const { companyId, name, githubOrg } = (await request.json()) as {
        companyId: string;
        name?: string;
        githubOrg?: string;
      };

      if (!companyId) {
        return json({ error: 'companyId is required' }, { status: 400 });
      }

      /*
       * companyId arrives in the body, so without this any signed-in user could rename any
       * workspace or repoint its GitHub org just by knowing an id — there was no membership check
       * at all here. Same gate as the membership routes use.
       */
      const member = await getCompanyMember(companyId, user.id);

      if (!isWorkspaceOwner(member?.role)) {
        return json({ error: 'Only the workspace owner can change workspace settings' }, { status: 403 });
      }

      /*
       * `plan` is deliberately no longer accepted. It is written nowhere else and read for nothing
       * — entitlements come from the subscription tier and companies.seats, both set by the Stripe
       * webhook — so letting a request set it only ever misrepresented the workspace.
       */
      const success = await updateCompany(companyId, { name, github_org: githubOrg });

      return json({ success });
    }

    if (method === 'DELETE') {
      const { companyId } = (await request.json()) as { companyId?: string };

      if (!companyId) {
        return json({ error: 'companyId is required' }, { status: 400 });
      }

      /*
       * Archive, not destroy — see the note in schema.sql. The billing plan is untouched: it is an
       * account-level entitlement to HAVE workspaces, not a charge for this particular one, so the
       * owner keeps their subscription and can create another in its place.
       *
       * Ownership and the personal-workspace exclusion are enforced inside archiveCompany's own
       * UPDATE, so a false return means one of those refused rather than a missing row.
       */
      const success = await archiveCompany(companyId, user.id);

      if (!success) {
        return json(
          { error: 'Only the workspace owner can delete it, and personal workspaces cannot be deleted.' },
          { status: 403 }
        );
      }

      await addAuditLog({
        companyId,
        actorId: user.id,
        action: 'ARCHIVE_WORKSPACE',
        payload: {},
        ipAddress: request.headers.get('x-forwarded-for'),
      });

      return json({ success: true });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    console.error('Error in companies action:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
