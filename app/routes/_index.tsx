import { json, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByUserId } from '~/lib/database';

export const meta: MetaFunction = () => {
  return [
    { title: 'Prompify' },
    { name: 'description', content: 'Talk with Prompify, an AI assistant from StackBlitz' },
  ];
};

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  console.log('🏠 Index route loader called with:', {
    url: request.url,
    method: request.method,
    contextKeys: context ? Object.keys(context) : 'no context'
  });

  // Check if authentication is disabled first
  if (isAuthDisabled(context)) {
    console.log('🚫 Authentication disabled - bypassing auth check entirely');
    const mockUser = getMockAdminUser();
    console.log('✅ Returning mock admin user for bypass:', mockUser);
    return json({ user: mockUser });
  }

  // Only check authentication if it's enabled
  console.log('🔒 Authentication enabled - checking user auth...');
  const user = await requireAuth(request, context);
  const sub = await getSubscriptionByUserId(user.id);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  console.log('👤 User loaded in index route:', userWithTier);

  return json({ user: userWithTier });
};

/**
 * Landing page component for Prompify
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
