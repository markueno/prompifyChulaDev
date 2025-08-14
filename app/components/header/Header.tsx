import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { useLoaderData } from '@remix-run/react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { UserProfile } from '~/components/auth/UserProfile';

export function Header() {
  const chat = useStore(chatStore);
  const { user } = useLoaderData<{ user: any }>();
  
  // Check if user is the bypass admin user
  const isBypassed = user?.id === 'admin-bypass';

  return (
    <>
      {isBypassed && (
        <div className="bg-yellow-500 text-black px-4 py-2 text-center font-semibold">
          ⚠️ ADMIN MODE: Authentication is completely disabled - Direct access enabled
        </div>
      )}
      <header
        className={classNames('flex items-center p-5 border-b h-[var(--header-height)]', {
          'border-transparent': !chat.started,
          'border-bolt-elements-borderColor': chat.started,
        })}
      >
        <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
          <div className="i-ph:sidebar-simple-duotone text-xl" />
          <a href="/" className="text-2xl font-semibold text-accent flex items-center">
            {/* <span className="i-bolt:logo-text?mask w-[46px] inline-block" /> */}
            <img src="/logo-light-styled.png" alt="logo" className="w-[90px] inline-block dark:hidden" />
            <img src="/logo-dark-styled.png" alt="logo" className="w-[90px] inline-block hidden dark:block" />
          </a>
        </div>
        {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
          <>
            <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
              <ClientOnly>{() => <ChatDescription />}</ClientOnly>
            </span>
            <ClientOnly>
              {() => (
                <div className="mr-1 flex items-center gap-2">
                  <HeaderActionButtons />
                  {user && <UserProfile user={user} />}
                </div>
              )}
            </ClientOnly>
          </>
        )}
      </header>
    </>
  );
}
