import { json, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import { Menu } from '~/components/sidebar/Menu.client';
import { SafeBoundary } from '~/components/ui/SafeBoundary';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getAllUserTables } from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';
import landingStyles from '~/styles/landing.css?url';
import { buildProjectChatPath, DEFAULT_PROJECT_ID } from '~/utils/chatRoutes';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    const tables = await getAllUserTables(mockUser.id);

    return json({ user: mockUser, tables, grouped: groupByProject(tables), isCompany: false });
  }

  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const tables = await getAllUserTables(user.id, companyId);
  const isCompany = companyId !== `cmp_personal_${user.id}`;

  return json({ user, tables, grouped: groupByProject(tables), isCompany });
}

function groupByProject(tables: any[]) {
  const groups: Record<
    string,
    { projectName: string; chatUrlId: string | null; projectId: string | null; tables: any[] }
  > = {};

  for (const t of tables) {
    const key = t.chat_url_id ?? t.project_id ?? 'unknown';

    if (!groups[key]) {
      groups[key] = {
        projectName: t.project_name ?? 'Untitled project',
        chatUrlId: t.chat_url_id,
        projectId: t.project_id,
        tables: [],
      };
    }

    groups[key].tables.push(t);
  }

  return Object.values(groups);
}

export const links: LinksFunction = () => [
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap',
  },
  { rel: 'stylesheet', href: landingStyles },
];

export const meta: MetaFunction = () => [
  { name: 'robots', content: 'noindex' },
  { title: 'Data — Prompify' },
  { name: 'description', content: 'Browse all tables across your projects.' },
];

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-gray-500/15 text-gray-600 dark:text-gray-400">Uncategorized</span>
    );
  }

  const isMaster = category === 'master';

  return (
    <span
      className={
        isMaster
          ? 'text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400'
          : 'text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400'
      }
    >
      {isMaster ? 'Master' : 'Transactional'}
    </span>
  );
}

function WorkspaceBadge({ workspaceType }: { workspaceType: string }) {
  return workspaceType === 'company' ? (
    <span className="text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400">Company</span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400">Personal</span>
  );
}

export default function DataPage() {
  const { grouped, isCompany } = useLoaderData<typeof loader>();

  const totalTables = grouped.reduce((sum: number, g: any) => sum + g.tables.length, 0);
  const totalRows = grouped.reduce(
    (sum: number, g: any) => sum + g.tables.reduce((s: number, t: any) => s + (t.row_count ?? 0), 0),
    0
  );

  return (
    <LandingAppChrome>
      <div className="landing-app-chrome flex min-h-0 w-full flex-1 flex-col">
        <SafeBoundary label="sidebar">
          <ClientOnly>{() => <Menu />}</ClientOnly>
        </SafeBoundary>
        <Header />

        <main className="mx-auto w-full max-w-5xl flex-1 overflow-auto px-5 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">Data</h1>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">
              All tables across all your projects. {totalTables} tables, {totalRows.toLocaleString()} total rows.
            </p>
          </div>

          {grouped.length === 0 ? (
            <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-8 text-center">
              <div className="i-ph:database text-4xl text-bolt-elements-textSecondary mx-auto" />
              <p className="mt-4 text-sm text-bolt-elements-textSecondary">
                No tables yet. Create a project and ask the AI to generate data to see tables here.
              </p>
              <Link
                to="/app/"
                className="mt-4 inline-block rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#ea5a0c]"
              >
                Go to app
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map((group: any) => {
                const chatPath = buildProjectChatPath(group.projectId || DEFAULT_PROJECT_ID, group.chatUrlId || '');

                return (
                  <section
                    key={group.chatUrlId ?? group.projectId ?? 'unknown'}
                    className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 overflow-hidden"
                  >
                    <div className="flex items-center justify-between border-b border-bolt-elements-borderColor px-5 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">{group.projectName}</h2>
                        <p className="text-xs text-bolt-elements-textSecondary">{group.tables.length} tables</p>
                      </div>
                      <Link
                        to={chatPath}
                        className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-xs font-medium text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2"
                      >
                        Open project
                      </Link>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-bolt-elements-borderColor text-left text-xs uppercase tracking-wide text-bolt-elements-textSecondary">
                          <th className="px-5 py-2 font-medium">Table</th>
                          <th className="px-5 py-2 font-medium">Rows</th>
                          <th className="px-5 py-2 font-medium">Category</th>
                          <th className="px-5 py-2 font-medium">Workspace</th>
                          {isCompany ? <th className="px-5 py-2 font-medium">Created by</th> : null}
                          <th className="px-5 py-2 font-medium">Schema</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.tables.map((t: any) => (
                          <tr
                            key={t.id}
                            className="border-b border-bolt-elements-borderColor last:border-0 hover:bg-bolt-elements-background-depth-2"
                          >
                            <td className="px-5 py-2.5 font-medium text-bolt-elements-textPrimary">{t.logical_name}</td>
                            <td className="px-5 py-2.5 text-bolt-elements-textSecondary">
                              {(t.row_count ?? 0).toLocaleString()}
                            </td>
                            <td className="px-5 py-2.5">
                              <CategoryBadge category={t.category} />
                            </td>
                            <td className="px-5 py-2.5">
                              <WorkspaceBadge workspaceType={t.workspace_type} />
                            </td>
                            {isCompany ? (
                              <td className="px-5 py-2.5 text-xs text-bolt-elements-textSecondary">
                                {t.creator_email ?? '—'}
                              </td>
                            ) : null}
                            <td className="px-5 py-2.5 text-xs text-bolt-elements-textTertiary font-mono">
                              {t.schema_name}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </LandingAppChrome>
  );
}
