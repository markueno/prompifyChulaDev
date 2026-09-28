import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import { useActionData, useLoaderData } from '@remix-run/react';
import { requireAuth } from '~/lib/auth';
import { acceptCompanyInvitationByToken, acceptInvitationByToken } from '~/lib/database';

export const meta: MetaFunction = () => [
  { name: 'robots', content: 'noindex, nofollow' },
  { title: 'Accept Invitation — Prompify' },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  /*
   * Workspace invites carry ?kind=workspace. Project invites predate the parameter and omit it,
   * so its absence means "project" — the older shape has to stay the default.
   */
  const isWorkspace = url.searchParams.get('kind') === 'workspace';

  if (!token) {
    return redirect('/app/');
  }

  return json({ token, isWorkspace, user: { id: user.id, email: user.email } });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  const formData = await request.formData();
  const token = formData.get('token') as string;

  if (!token) {
    return json({ success: false, error: 'Invalid invitation link' }, { status: 400 });
  }

  if (formData.get('kind') === 'workspace') {
    const joined = await acceptCompanyInvitationByToken(token, user.id, user.email);

    if (joined.success) {
      // The workspace's own page, not a chat — a new member may have no chats yet.
      throw redirect(joined.companySlug ? `/c/${joined.companySlug}` : '/app/');
    }

    return json({ success: false, error: joined.error });
  }

  const result = await acceptInvitationByToken(token, user.id, user.email);

  if (result.success && result.chatUrl) {
    throw redirect(result.chatUrl);
  }

  return json({ success: false, error: result.error });
}

export default function AcceptInvitePage() {
  const { token, isWorkspace, user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1 p-4">
      <div className="w-full max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-bolt-elements-textPrimary mb-2">Accept Invitation</h1>
        <p className="text-sm text-bolt-elements-textSecondary mb-4">
          {isWorkspace
            ? "You've been invited to join a workspace. Accept to share its projects, data and tokens."
            : "You've been invited to collaborate on a project. Accept to get access to the chat history, code, and preview."}
        </p>
        <form method="post">
          <input type="hidden" name="token" value={token} />
          {isWorkspace ? <input type="hidden" name="kind" value="workspace" /> : null}
          <button
            type="submit"
            className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600"
          >
            Accept Invitation
          </button>
        </form>
        {actionData?.error && <p className="mt-4 text-sm text-red-500">{actionData.error}</p>}
        <p className="mt-4 text-xs text-bolt-elements-textTertiary">Logged in as {user.email}</p>
      </div>
    </div>
  );
}
