import { useStore } from '@nanostores/react';
import { Dropdown } from '~/components/ui/Dropdown';
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
  const displayInitial = displayName
    ? displayName.charAt(0).toUpperCase()
    : (user?.email?.charAt(0).toUpperCase() ?? '');

  if (!user || !user.email) {
    return null;
  }

  const trigger = (
    <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium border border-[#fed7aa]/60 bg-[#f0e4d5] text-[#231710] hover:border-[#f97316] hover:bg-[#fed7aa] transition-colors">
      <div className="w-6 h-6 bg-[#f97316] rounded-full flex items-center justify-center text-white text-xs font-semibold">
        {displayInitial}
      </div>
      <span className="hidden md:block text-sm font-medium">{displayName || user.email}</span>
      <div className="i-ph:caret-down text-xs opacity-60" />
    </button>
  );

  return (
    <Dropdown trigger={trigger}>
      <div className="w-56 rounded-xl border border-[#fed7aa]/60 bg-[#f0e4d5] p-1.5 shadow-lg">
        <div className="px-2.5 py-2 border-b border-[#fed7aa]/40 flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-[#231710]">{displayName || user.email}</p>
          {user.accountTier ? (
            <span className="text-xs font-medium text-[#231710]/50 shrink-0">{user.accountTier}</span>
          ) : null}
        </div>

        {user.isModerator && (
          <>
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-2 text-sm w-full text-left text-[#231710]/70 hover:bg-[#fed7aa]/50 rounded-lg transition-colors"
              onClick={() => controlPanelOpenStore.set(true)}
            >
              <div className="i-ph:gear text-lg" />
              Settings
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-2 text-sm w-full text-left text-[#231710]/70 hover:bg-[#fed7aa]/50 rounded-lg transition-colors"
              onClick={() => {
                controlPanelInitialTabStore.set('profile');
                controlPanelOpenStore.set(true);
              }}
            >
              <div className="i-ph:user text-lg" />
              Profile
            </button>
          </>
        )}

        <div className="my-1 border-t border-[#fed7aa]/40" />

        <form action="/auth/logout" method="post" className="w-full">
          <button
            type="submit"
            className="flex items-center gap-2 px-2.5 py-2 text-sm w-full text-left text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <div className="i-ph:sign-out text-lg" />
            Sign Out
          </button>
        </form>
      </div>
    </Dropdown>
  );
}
