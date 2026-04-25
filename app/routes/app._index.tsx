import { json, type LinksFunction, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { LandingAppChrome } from '~/components/landing/LandingAppChrome';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByUserId } from '~/lib/database';
import landingStyles from '~/styles/landing.css?url';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    return json({ user: mockUser });
  }
  const user = await requireAuth(request, context);
  const sub = await getSubscriptionByUserId(user.id);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };
  return json({ user: userWithTier });
}

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap' },
  { rel: 'stylesheet', href: landingStyles },
];

export const meta: MetaFunction = () => {
  return [
    { title: 'Prompify - App Builder' },
    { name: 'description', content: 'Describe what you need in plain English and get a working, live app in your screen.' },
  ];
};

export default function AppIndex() {
  return (
    <LandingAppChrome>
      <div className="landing-app-chrome flex min-h-0 w-full flex-1 flex-col">
        <Header />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
        </div>
      </div>
    </LandingAppChrome>
  );
}
