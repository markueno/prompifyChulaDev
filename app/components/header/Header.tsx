import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { Link, useLoaderData, useLocation } from '@remix-run/react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { NotificationBell } from './NotificationBell.client';
import { ConnectionStatusBanner } from '~/components/chat/ConnectionStatusBanner.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { UserProfile } from '~/components/auth/UserProfile';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.client';

export function Header() {
  const chat = useStore(chatStore);
  const { user } = useLoaderData<{ user: any }>();
  const location = useLocation();
  const onOverview = location.pathname.startsWith('/app/overview');
  const onPricing = location.pathname.startsWith('/app/pricing');

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
          <Link to="/app/" className="text-2xl font-semibold text-accent flex items-center">
            {/* <span className="i-bolt:logo-text?mask w-[46px] inline-block" /> */}
            <img src="/prompify2.png" alt="Prompify" className="w-[40px] inline-block ml-1" />
          </Link>
        </div>
        {user ? (
          <>
            <Link
              to="/app/overview"
              className={classNames(
                'header-nav-overview hidden text-sm font-medium sm:inline-block rounded-md px-2 py-1 transition-colors',
                onOverview ? 'bg-white/10 text-white' : 'text-white/90 hover:text-white'
              )}
            >
              Overview
            </Link>
            <Link
              to="/app/pricing"
              className={classNames(
                'header-nav-pricing hidden text-sm font-medium sm:inline-block rounded-md px-2 py-1 transition-colors',
                onPricing ? 'bg-white/10 text-white' : 'text-white/90 hover:text-white'
              )}
            >
              Pricing
            </Link>
          </>
        ) : null}
      </div>
      {chat.started ? (
        <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
          <ClientOnly>{() => <ChatDescription />}</ClientOnly>
        </span>
      ) : (
        <span className="flex-1 text-center text-lg font-bold text-white">Prompify</span>
      )}
      <ClientOnly>
        {() => (
          <div className="header-app-toolbar mr-1 flex items-center gap-2">
            {/* Day 12 — offline/syncing/recovered indicator (ARCHITECTURE-v2.md:672-680). */}
            <ConnectionStatusBanner />
            {chat.started && <HeaderActionButtons />}
            {user && (
              <>
                <ClientOnly>{() => <WorkspaceSwitcher />}</ClientOnly>
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
