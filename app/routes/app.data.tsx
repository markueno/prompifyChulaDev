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

    return json({ user: mockUser, tables, grouped: groupByTable(tables), isCompany: false });
  }

  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const tables = await getAllUserTables(user.id, companyId);
  const isCompany = companyId !== `cmp_personal_${user.id}`;

  return json({ user, tables, grouped: groupByTable(tables), isCompany });
}

/**
 * One entry per physical table, carrying the projects that use it.
 *
 * Grouped on (schema_name, table_name) rather than on the row id: a table shared across projects
 * is several app_tables rows — one registration per chat — all pointing at the same physical
 * table. Grouping by id would list it once per project and make shared data look duplicated,
 * which is the opposite of what the page is meant to show.
 */
function groupByTable(tables: any[]) {
  const groups: Record<
    string,
    {
      key: string;
      logicalName: string;
      category: string | null;
      workspaceType: string;
      creatorEmail: string | null;
      /** Identical across the group — the rows describe one physical table, so never summed. */
      rowCount: number;
      projects: { name: string; chatUrlId: string | null; projectId: string | null }[];
    }
  > = {};

  for (const t of tables) {
    const key = `${t.schema_name}.${t.table_name}`;

    if (!groups[key]) {
      groups[key] = {
        key,
        logicalName: t.logical_name,
        category: t.category,
        workspaceType: t.workspace_type,
        creatorEmail: t.creator_email,
        rowCount: t.row_count ?? 0,
        projects: [],
      };
    }

    groups[key].projects.push({
      name: t.project_name ?? 'Untitled project',
      chatUrlId: t.chat_url_id,
      projectId: t.project_id,
    });
  }

  return Object.values(groups).sort((a, b) => a.logicalName.localeCompare(b.logicalName));
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

function WorkspaceBadge({ workspaceType }: { workspaceType: string }) {
  return workspaceType === 'company' ? (
    <span className="text-xs px-2 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400">Company</span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400">Personal</span>
  );
}

/** The projects registered against one physical table, each linking into its chat. */
function ProjectLinks({
  projects,
}: {
  projects: { name: string; chatUrlId: string | null; projectId: string | null }[];
}) {
  if (projects.length === 0) {
    return <span className="text-xs text-bolt-elements-textTertiary">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {projects.map(project => (
        <Link
          key={`${project.projectId ?? ''}-${project.chatUrlId ?? ''}`}
          to={buildProjectChatPath(project.projectId || DEFAULT_PROJECT_ID, project.chatUrlId || '')}
          className="rounded border border-bolt-elements-borderColor px-2 py-0.5 text-xs text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2"
        >
          {project.name}
        </Link>
      ))}
    </div>
  );
}

function TableSection({
  title,
  blurb,
  groups,
  isCompany,
}: {
  title: string;
  blurb: string;
  groups: any[];
  isCompany: boolean;
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 overflow-hidden">
      <div className="border-b border-bolt-elements-borderColor px-5 py-3">
        <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">
          {title} <span className="font-normal text-bolt-elements-textSecondary">({groups.length})</span>
        </h2>
        <p className="mt-0.5 text-xs text-bolt-elements-textSecondary">{blurb}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bolt-elements-borderColor text-left text-xs uppercase tracking-wide text-bolt-elements-textSecondary">
              <th className="px-5 py-2 font-medium">Table</th>
              <th className="px-5 py-2 font-medium">Rows</th>
              <th className="px-5 py-2 font-medium">Used by</th>
              <th className="px-5 py-2 font-medium">Workspace</th>
              {isCompany ? <th className="px-5 py-2 font-medium">Created by</th> : null}
            </tr>
          </thead>
          <tbody>
            {groups.map((group: any) => (
              <tr
                key={group.key}
                className="border-b border-bolt-elements-borderColor last:border-0 hover:bg-bolt-elements-background-depth-2"
              >
                <td className="px-5 py-2.5 align-top font-medium text-bolt-elements-textPrimary">
                  {group.logicalName}
                  {group.projects.length > 1 ? (
                    <span className="ml-2 text-xs font-normal text-bolt-elements-textTertiary">
                      shared by {group.projects.length}
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-2.5 align-top text-bolt-elements-textSecondary">
                  {group.rowCount.toLocaleString()}
                </td>
                <td className="px-5 py-2.5 align-top">
                  <ProjectLinks projects={group.projects} />
                </td>
                <td className="px-5 py-2.5 align-top">
                  <WorkspaceBadge workspaceType={group.workspaceType} />
                </td>
                {isCompany ? (
                  <td className="px-5 py-2.5 align-top text-xs text-bolt-elements-textSecondary">
                    {group.creatorEmail ?? '—'}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DataPage() {
  const { grouped, isCompany } = useLoaderData<typeof loader>();

  /*
   * Counted per physical table, not per registration — a table shared by three projects is one
   * table holding one set of rows. Summing the rows of every registration would treat shared
   * master data as if each project had its own copy.
   */
  const totalTables = grouped.length;
  const totalRows = grouped.reduce((sum: number, g: any) => sum + g.rowCount, 0);

  const master = grouped.filter((g: any) => g.category === 'master');
  const transactional = grouped.filter((g: any) => g.category !== 'master');

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
            <div className="space-y-8">
              <TableSection
                title="Master data"
                blurb="Reference tables shared across projects. Building a new app reuses these rather than creating a second copy."
                groups={master}
                isCompany={isCompany}
              />
              <TableSection
                title="Transactional data"
                blurb="Records belonging to a single project. These are never shared between apps."
                groups={transactional}
                isCompany={isCompany}
              />
            </div>
          )}
        </main>
      </div>
    </LandingAppChrome>
  );
}
