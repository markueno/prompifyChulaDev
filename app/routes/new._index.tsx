import type { MetaFunction, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { QuestionFlow } from '~/components/questionnaire/QuestionFlow.client';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';

export const meta: MetaFunction = () => [
  { title: 'Build your app — Prompify' },
  { name: 'description', content: 'Answer a few questions and get a production-ready AI prompt for your app.' },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    return json({ user: mockUser });
  }
  const user = await requireAuth(request, context);
  return json({ user });
}

export default function NewRoute() {
  return (
    <div className="h-screen flex flex-col bg-bolt-elements-background-depth-1 overflow-hidden">
      <header className="shrink-0 h-14 flex items-center px-6 border-b border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2">
        <a href="/" className="text-sm font-semibold text-bolt-elements-textPrimary hover:text-accent-500 transition-colors">
          Prompify
        </a>
        <span className="mx-2 text-bolt-elements-textTertiary">/</span>
        <span className="text-sm text-bolt-elements-textSecondary">Build your app</span>
      </header>

      <div className="flex-1 min-h-0">
        <ClientOnly fallback={
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-bolt-elements-textTertiary">Loading…</div>
          </div>
        }>
          {() => <QuestionFlow />}
        </ClientOnly>
      </div>
    </div>
  );
}
