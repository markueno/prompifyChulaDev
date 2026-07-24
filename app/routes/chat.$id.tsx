import { redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import AppIndexRoute, { links, meta } from './app._index';

export { links, meta };
import { buildProjectChatPath, DEFAULT_PROJECT_ID } from '~/utils/chatRoutes';
import { getChatById } from '~/lib/database';
import { getMockAdminUser, isAuthDisabled, requireAuth } from '~/lib/auth';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  if (!params.id) {
    throw redirect('/app/');
  }

  let projectId = DEFAULT_PROJECT_ID;

  if (!isAuthDisabled(context)) {
    const user = await requireAuth(request, context);
    const chat = await getChatById(params.id, user.id, user.isModerator);

    if (!chat) {
      throw redirect('/app/');
    }

    projectId = chat.project_id || DEFAULT_PROJECT_ID;
  } else {
    const mockUser = getMockAdminUser();
    const chat = await getChatById(params.id, mockUser.id, true);
    projectId = chat?.project_id || DEFAULT_PROJECT_ID;
  }

  const currentUrl = new URL(request.url);
  const target = new URL(buildProjectChatPath(projectId, params.id), currentUrl.origin);
  target.search = currentUrl.search;
  throw redirect(`${target.pathname}${target.search}`);
}

export default AppIndexRoute;

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
