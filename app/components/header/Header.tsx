import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { Link, useLoaderData, useLocation } from '@remix-run/react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { NotificationBell } from './NotificationBell.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { UserProfile } from '~/components/auth/UserProfile';

export function Header() {
  const chat = useStore(chatStore);
  const { user } = useLoaderData<{ user: any }>();
  const location = useLocation();
  const onOverview = location.pathname.startsWith('/app/overview');

  return (
    <header
        className={classNames('flex items-center p-5 border-b h-[var(--header-height)]', {
          'border-transparent': !chat.started,
          'border-bolt-elements-borderColor': chat.started,
        })}
      >
        <div className="flex items-center gap-4 z-logo text-bolt-elements-textPrimary cursor-pointer">
          <div className="flex items-center gap-2">
            <div className="i-ph:sidebar-simple-duotone text-xl" />
            <Link to="/app" className="text-2xl font-semibold text-accent flex items-center">
              {/* <span className="i-bolt:logo-text?mask w-[46px] inline-block" /> */}
              <img src="/logo-light-styled.png" alt="logo" className="w-[90px] inline-block dark:hidden" />
              <img src="/logo-dark-styled.png" alt="logo" className="w-[90px] inline-block hidden dark:block" />
            </Link>
          </div>
          {user ? (
            <Link
              to="/app/overview"
              className={classNames(
                'hidden text-sm font-medium sm:inline-block rounded-md px-2 py-1 transition-colors',
                onOverview
                  ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary'
                  : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary'
              )}
            >
              Overview
            </Link>
          ) : null}
        </div>
        {chat.started ? (
          <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <ClientOnly>
          {() => (
            <div className="mr-1 flex items-center gap-2">
              {chat.started && <HeaderActionButtons />}
              {user && (
                <>
                  <NotificationBell />
                  <UserProfile user={user} />
                </>
              )}
            </div>
          )}
        </ClientOnly>
      </header>
  );
}
