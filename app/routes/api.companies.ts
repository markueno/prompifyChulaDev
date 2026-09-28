import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { isWorkspaceOwner } from '~/lib/workspace-roles';
import { createCompany, getCompanyBySlug, getCompanyMember, getUserCompanies, updateCompany } from '~/lib/database';

export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const companies = await getUserCompanies(user.id);

    return json({ companies });
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

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    console.error('Error in companies action:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
