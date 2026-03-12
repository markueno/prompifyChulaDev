import { json, type MetaFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByUserId } from '~/lib/database';

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
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

export const meta: MetaFunction = () => {
  return [
    { title: 'Prompify - App Builder' },
    { name: 'description', content: 'Build your app with Prompify AI' },
  ];
};

export default function AppIndex() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
