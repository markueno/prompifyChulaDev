import { json, redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import { requireAuth } from '~/lib/auth';
import { getCompanyBySlug, getCompanyMember, getCompanyApps } from '~/lib/database';
import { AppStatusCard } from '~/components/company/AppStatusCard';
import { Button } from '~/components/ui/Button';
import type { CompanyApp, CompanyRole } from '~/lib/database';

interface LoaderData {
  company: { id: string; name: string; slug: string; github_org: string | null };
  apps: CompanyApp[];
  userRole: CompanyRole;
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const slug = params.slug!;

  const company = await getCompanyBySlug(slug);
  if (!company) {
    throw redirect('/company/new');
  }

  const member = await getCompanyMember(company.id, user.id);
  if (!member) {
    throw new Response('Forbidden', { status: 403 });
  }

  const apps = await getCompanyApps(company.id);

  return json<LoaderData>({
    company: { id: company.id, name: company.name, slug: company.slug, github_org: company.github_org },
    apps,
    userRole: member.role,
  });
}

const STATUS_ORDER = ['active', 'building', 'sleeping', 'draft', 'failed'] as const;

export default function CompanyDashboard() {
  const { company, apps, userRole } = useLoaderData<LoaderData>();
  const canBuild = userRole === 'admin' || userRole === 'developer';

  const grouped = STATUS_ORDER.reduce<Record<string, CompanyApp[]>>((acc, s) => {
    acc[s] = apps.filter((a) => a.status === s);
    return acc;
  }, {} as Record<string, CompanyApp[]>);

  return (
    <div className="min-h-screen bg-bolt-elements-background-depth-1">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">{company.name}</h1>
            <p className="text-sm text-bolt-elements-textSecondary mt-0.5">
              {apps.length} app{apps.length !== 1 ? 's' : ''}
              {' · '}
              {apps.filter((a) => a.status === 'active').length} active
            </p>
          </div>
          <div className="flex gap-2">
            <Link to={`/c/${company.slug}/settings`}>
              <Button variant="outline" size="sm">Settings</Button>
            </Link>
            {canBuild && (
              <Link to={`/app?company=${company.slug}`}>
                <Button size="sm">+ New App</Button>
              </Link>
            )}
          </div>
        </div>

        {apps.length === 0 ? (
          <div className="text-center py-16 text-bolt-elements-textSecondary">
            <p className="text-lg mb-2">No apps yet</p>
            {canBuild && (
              <Link to={`/app?company=${company.slug}`}>
                <Button>Build your first app</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {STATUS_ORDER.map((status) => {
              const group = grouped[status];
              if (!group || group.length === 0) return null;
              return (
                <section key={status}>
                  <h2 className="text-sm font-medium text-bolt-elements-textSecondary uppercase tracking-wide mb-3">
                    {status.charAt(0).toUpperCase() + status.slice(1)} ({group.length})
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.map((app) => (
                      <AppStatusCard
                        key={app.id}
                        app={app}
                        companySlug={company.slug}
                        userRole={userRole}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
