import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import { optionalAuth } from '~/lib/auth';
import { getInviteCodeInfo } from '~/lib/database';

export const meta: MetaFunction = () => [
  { name: 'robots', content: 'noindex' },
  { title: 'Join Workspace — Prompify' },
];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const code = params.code?.trim().toUpperCase();

  if (!code) {
    return json({ error: 'Missing invite code' }, { status: 400 });
  }

  const info = await getInviteCodeInfo(code);

  if (!info) {
    return json({ error: 'Invalid invite code', code }, { status: 404 });
  }

  const user = await optionalAuth(request, context);

  return json({ ...info, code, isLoggedIn: Boolean(user) });
}

export default function JoinByCode() {
  const data = useLoaderData<typeof loader>();

  if ('error' in data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bolt-elements-background">
        <div className="max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-8 text-center">
          <div className="i-ph:x-circle text-4xl text-red-500" />
          <h1 className="mt-4 text-xl font-semibold text-bolt-elements-textPrimary">Invite link invalid</h1>
          <p className="mt-2 text-sm text-bolt-elements-textSecondary">{data.error}</p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-lg border border-bolt-elements-borderColor px-4 py-2 text-sm font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (!data.isValid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bolt-elements-background">
        <div className="max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-8 text-center">
          <div className="i-ph:warning-circle text-4xl text-amber-500" />
          <h1 className="mt-4 text-xl font-semibold text-bolt-elements-textPrimary">Invite no longer available</h1>
          <p className="mt-2 text-sm text-bolt-elements-textSecondary">{data.reason}</p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-lg border border-bolt-elements-borderColor px-4 py-2 text-sm font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bolt-elements-background">
      <div className="max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-8 text-center">
        <div className="i-ph:buildings-duotone text-4xl text-[#f97316]" />
        <h1 className="mt-4 text-xl font-semibold text-bolt-elements-textPrimary">Join {data.companyName}</h1>
        <p className="mt-2 text-sm text-bolt-elements-textSecondary">
          You've been invited to join the <span className="font-medium">{data.companyName}</span> workspace on Prompify.
        </p>

        {data.isLoggedIn ? (
          <JoinButton code={data.code} />
        ) : (
          <div className="mt-6 space-y-3">
            <Link
              to={`/auth/login?redirect=/join/${data.code}`}
              className="block w-full rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#ea5a0c]"
            >
              Log in to join
            </Link>
            <Link
              to={`/auth/signup?redirect=/join/${data.code}`}
              className="block w-full rounded-lg border border-bolt-elements-borderColor px-4 py-2.5 text-sm font-medium text-bolt-elements-textPrimary transition-colors hover:bg-bolt-elements-background-depth-2"
            >
              Create an account
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function JoinButton({ code }: { code: string }) {
  return (
    <div className="mt-6">
      <form
        onSubmit={async e => {
          e.preventDefault();

          const form = e.currentTarget;
          const btn = form.querySelector('button');

          if (btn) {
            btn.textContent = 'Joining...';
            (btn as HTMLButtonElement).disabled = true;
          }

          try {
            const res = await fetch('/api/companies/join', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code }),
            });

            if (res.ok) {
              window.location.href = '/app/';
            } else {
              const data = (await res.json().catch(() => ({}))) as { error?: string };
              alert(data.error || 'Failed to join workspace');

              if (btn) {
                btn.textContent = 'Join workspace';
                (btn as HTMLButtonElement).disabled = false;
              }
            }
          } catch {
            alert('Network error. Please try again.');

            if (btn) {
              btn.textContent = 'Join workspace';
              (btn as HTMLButtonElement).disabled = false;
            }
          }
        }}
      >
        <button
          type="submit"
          className="w-full rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#ea5a0c]"
        >
          Join workspace
        </button>
      </form>
    </div>
  );
}
