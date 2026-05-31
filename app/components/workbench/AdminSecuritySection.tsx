import { useRouteLoaderData } from '@remix-run/react';
import { controlPanelInitialTabStore, controlPanelOpenStore } from '~/lib/stores/settings';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

/**
 * Bolt-style admin “Security”: overview + links into existing Prompify features
 * (no separate backend — aligns with OSS bolt.diy patterns).
 */
export function AdminSecuritySection() {
  const appLayout = useRouteLoaderData('routes/app') as { user?: { isModerator?: boolean } } | undefined;
  const appIndex = useRouteLoaderData('routes/app._index') as { user?: { isModerator?: boolean } } | undefined;
  const chatRoute = useRouteLoaderData('routes/chat.$id') as { user?: { isModerator?: boolean } } | undefined;
  const user = chatRoute?.user ?? appIndex?.user ?? appLayout?.user;
  const isModerator = user?.isModerator === true;

  const cookieKeysHint =
    typeof document !== 'undefined'
      ? [...document.cookie.split(';').map(c => c.split('=')[0].trim())].filter(Boolean).length
      : 0;

  return (
    <div className="space-y-6 text-sm text-bolt-elements-textSecondary">
      <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
        <h2 className="text-base font-medium text-bolt-elements-textPrimary mb-2 flex items-center gap-2">
          <span className="i-ph:lock-simple text-lg text-bolt-elements-textSecondary" aria-hidden />
          Access & collaborators
        </h2>
        <p className="mb-3">
          Use <strong className="text-bolt-elements-textPrimary">Admin → Users</strong> to manage who can access this
          chat project (roles, invitations). That is your main access-control surface for shared chats.
        </p>
        <button
          type="button"
          className={classNames(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            'border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2',
            'hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary transition-colors'
          )}
          onClick={() => workbenchStore.adminPanelSection.set('users')}
        >
          <span className="i-ph:users w-4 h-4" aria-hidden />
          Open Users
        </button>
      </div>

      <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
        <h2 className="text-base font-medium text-bolt-elements-textPrimary mb-2 flex items-center gap-2">
          <span className="i-ph:database text-lg text-bolt-elements-textSecondary" aria-hidden />
          Data on this browser
        </h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Provider API keys and related settings may be stored in{' '}
            <strong className="text-bolt-elements-textPrimary">cookies</strong> (same pattern as Bolt OSS). Prefer
            env-based keys on your server where possible for production deployments.
          </li>
          <li>
            <strong className="text-bolt-elements-textPrimary">Event logs</strong> live in-browser (cookie + memory).
            They help debug UX; treat them as non-audit diagnostics, not tamper-proof security logs.
          </li>
          {typeof cookieKeysHint === 'number' && cookieKeysHint > 0 ? (
            <li className="text-bolt-elements-textTertiary">
              Approx. {cookieKeysHint} cookie name(s) set for this origin (values not shown).
            </li>
          ) : null}
        </ul>
      </div>

      <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
        <h2 className="text-base font-medium text-bolt-elements-textPrimary mb-2 flex items-center gap-2">
          <span className="i-ph:list-bullets text-lg text-bolt-elements-textSecondary" aria-hidden />
          Diagnostics & audits
        </h2>
        <p className="mb-3">
          Review client-side activity in <strong className="text-bolt-elements-textPrimary">Admin → Logs</strong> (Event
          Logs UI). Enable{' '}
          <strong className="text-bolt-elements-textPrimary">Settings → Features → Event logging</strong> if you use
          Settings as a moderator.
        </p>
        <button
          type="button"
          className={classNames(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            'border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2',
            'hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary transition-colors'
          )}
          onClick={() => workbenchStore.adminPanelSection.set('logs')}
        >
          <span className="i-ph:file-text w-4 h-4" aria-hidden />
          Open Event Logs
        </button>
      </div>

      {isModerator ? (
        <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
          <h2 className="text-base font-medium text-bolt-elements-textPrimary mb-2 flex items-center gap-2">
            <span className="i-ph:plug text-lg text-bolt-elements-textSecondary" aria-hidden />
            Connections & integrations
          </h2>
          <p className="mb-3">
            GitHub tokens and hosted provider configuration are edited in{' '}
            <strong className="text-bolt-elements-textPrimary">Settings → Connections / Providers</strong> (Bolt-style
            panels).
          </p>
          <button
            type="button"
            className={classNames(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
              'border border-accent-500/40 bg-accent-500/10',
              'hover:bg-accent-500/20 text-bolt-elements-textPrimary transition-colors'
            )}
            onClick={() => {
              controlPanelInitialTabStore.set('connection');
              controlPanelOpenStore.set(true);
            }}
          >
            <span className="i-ph:gear w-4 h-4" aria-hidden />
            Open Settings → Connection
          </button>
        </div>
      ) : (
        <p className="text-xs text-bolt-elements-textTertiary px-1">
          Moderators can open full Settings from the sidebar gear to configure API providers, Connections, and more
          detailed options.
        </p>
      )}
    </div>
  );
}
