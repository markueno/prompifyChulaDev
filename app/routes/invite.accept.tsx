import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import { useActionData, useLoaderData } from '@remix-run/react';
import { requireAuth } from '~/lib/auth';
import { acceptCompanyInvitationByToken, acceptInvitationByToken, getCompanyInvitationByToken } from '~/lib/database';

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

  /*
   * Name the workspace and who invited you before asking for a decision — "you have been invited
   * to a workspace" with no idea which, by whom, or as what is not enough to act on.
   */
  const invitation = isWorkspace ? await getCompanyInvitationByToken(token) : null;

  return json({ token, isWorkspace, invitation, user: { id: user.id, email: user.email } });
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

const ROLE_BLURB: Record<string, string> = {
  admin: 'You will be able to build, and to invite and manage members.',
  editor: 'You will be able to build in its projects.',
  viewer: 'You will be able to view its projects, but not change them.',
};

export default function AcceptInvitePage() {
  const { token, isWorkspace, invitation, user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  /*
   * An invitation is accepted by the address it was sent to. Someone who followed the link while
   * signed in as another account gets told so here rather than after submitting, since the error
   * from the server would otherwise be their first hint.
   */
  const wrongAccount = invitation && invitation.invitedEmail.toLowerCase() !== (user.email ?? '').toLowerCase();

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1 p-4">
      <div className="w-full max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-bolt-elements-textPrimary mb-2">
          {invitation ? `Join ${invitation.companyName}` : 'Accept Invitation'}
        </h1>

        {isWorkspace && !invitation ? (
          <p className="text-sm text-bolt-elements-textSecondary mb-4">
            This invitation has expired or has already been used. Ask whoever invited you to send another.
          </p>
        ) : (
          <p className="text-sm text-bolt-elements-textSecondary mb-4">
            {invitation ? (
              <>
                {invitation.inviterEmail ? (
                  <>
                    <strong className="text-bolt-elements-textPrimary">{invitation.inviterEmail}</strong> invited you
                    to{' '}
                  </>
                ) : (
                  "You've been invited to "
                )}
                <strong className="text-bolt-elements-textPrimary">{invitation.companyName}</strong> as a{' '}
                {invitation.role}. {ROLE_BLURB[invitation.role] ?? ''}
              </>
            ) : (
              "You've been invited to collaborate on a project. Accept to get access to the chat history, code, and preview."
            )}
          </p>
        )}

        {wrongAccount ? (
          <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-bolt-elements-textPrimary">
            This invitation was sent to <strong>{invitation.invitedEmail}</strong>, but you are signed in as{' '}
            <strong>{user.email}</strong>. Sign in as the invited address to accept it.
          </p>
        ) : null}

        {!isWorkspace || invitation ? (
          <form method="post">
            <input type="hidden" name="token" value={token} />
            {isWorkspace ? <input type="hidden" name="kind" value="workspace" /> : null}
            <button
              type="submit"
              disabled={Boolean(wrongAccount)}
              className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {invitation ? `Join ${invitation.companyName}` : 'Accept Invitation'}
            </button>
          </form>
        ) : null}

        {actionData?.error && <p className="mt-4 text-sm text-red-500">{actionData.error}</p>}
        <p className="mt-4 text-xs text-bolt-elements-textTertiary">Signed in as {user.email}</p>
      </div>
    </div>
  );
}
