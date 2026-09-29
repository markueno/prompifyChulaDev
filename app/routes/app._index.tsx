import { json, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { FloatingHeader } from '~/components/header/FloatingHeader';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getCompanyMember, getSubscriptionByCompanyId } from '~/lib/database';
import { personalCompanyId } from '~/lib/database-postgresql';
import { canBuildInWorkspace } from '~/lib/workspace-roles';
import { getActiveCompanyId } from '~/lib/workspace.server';
import landingStyles from '~/styles/landing.css?url';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    return json({ user: mockUser, canBuild: true });
  }

  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const [sub, member] = await Promise.all([
    getSubscriptionByCompanyId(companyId),
    getCompanyMember(companyId, user.id),
  ]);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  /*
   * Whether this person may prompt in the workspace they are currently in. Resolved on the server
   * so the composer is never rendered and then taken away, and so there is no moment where a
   * viewer can type into something that will be refused.
   *
   * A personal workspace has no member row and needs none — it is always your own.
   */
  const canBuild = companyId === personalCompanyId(user.id) ? true : canBuildInWorkspace(member?.role);

  return json({ user: userWithTier, canBuild });
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

export const meta: MetaFunction = () => {
  return [
    // Auth-gated app shell — don't index the login-redirect/builder surface.
    { name: 'robots', content: 'noindex' },
    { title: 'Prompify - App Builder' },
    {
      name: 'description',
      content: 'Describe what you need in plain English and get a working, live app in your screen.',
    },
  ];
};

export default function AppIndex() {
  return (
    <LandingAppChrome>
      <div className="landing-app-chrome flex min-h-0 w-full flex-1 flex-col">
        <FloatingHeader />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
        </div>
      </div>
    </LandingAppChrome>
  );
}

export function ErrorBoundary() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-gray-500">Please refresh the page and try again.</p>
      </div>
    </div>
  );
}
