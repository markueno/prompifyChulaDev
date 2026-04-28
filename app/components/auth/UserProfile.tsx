import { useStore } from '@nanostores/react';
import { Button } from '~/components/ui/Button';
import { Dropdown, DropdownItem, DropdownSeparator } from '~/components/ui/Dropdown';
import type { User } from '~/lib/auth';
import { controlPanelOpenStore, controlPanelInitialTabStore } from '~/lib/stores/settings';
import { profileStore } from '~/lib/stores/profile';

interface UserProfileProps {
  user: User | null;
}

export function UserProfile({ user }: UserProfileProps) {
  const profile = useStore(profileStore);
  // Display name: nickname if set, otherwise auth email
  const displayName = (profile?.nickname?.trim() || user?.email || '').trim();
  const displayInitial = displayName ? displayName.charAt(0).toUpperCase() : (user?.email?.charAt(0).toUpperCase() ?? '');

  if (!user || !user.email) {
    return null;
  }

  const trigger = (
    <Button variant="ghost" className="flex items-center gap-2 text-zinc-900 hover:text-black">
      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
        {displayInitial}
      </div>
      <span className="hidden md:block text-sm font-medium text-zinc-900">{displayName || user.email}</span>
      <div className="i-ph:caret-down text-sm text-zinc-900" />
    </Button>
  );

  return (
    <Dropdown trigger={trigger}>
      <div className="w-56">
        <div className="p-3 border-b border-bolt-elements-borderColor flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-bolt-elements-textPrimary">
            {displayName || user.email}
          </p>
          {user.accountTier ? (
            <span className="text-xs font-medium text-bolt-elements-textSecondary shrink-0">
              {user.accountTier}
            </span>
          ) : null}
        </div>

        {user.isModerator && (
          <>
            <DropdownSeparator />
            <DropdownItem asChild>
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive rounded cursor-pointer"
                onClick={() => controlPanelOpenStore.set(true)}
              >
                <div className="i-ph:gear text-lg" />
                Settings
              </button>
            </DropdownItem>
            <DropdownItem asChild>
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive rounded cursor-pointer"
                onClick={() => {
                  controlPanelInitialTabStore.set('profile');
                  controlPanelOpenStore.set(true);
                }}
              >
                <div className="i-ph:user text-lg" />
                Profile
              </button>
            </DropdownItem>
          </>
        )}

        <DropdownSeparator />

        <DropdownItem asChild onSelect={(e) => e.preventDefault()}>
          <form action="/auth/logout" method="post" className="w-full">
            <button
              type="submit"
              className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left text-red-600 hover:text-red-700"
            >
              <div className="i-ph:sign-out text-lg" />
              Sign Out
            </button>
          </form>
        </DropdownItem>
      </div>
    </Dropdown>
  );
} 