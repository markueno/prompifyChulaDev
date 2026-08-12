import { useStore } from '@nanostores/react';
import { useSubmit } from '@remix-run/react';
import { Dropdown, DropdownItem } from '~/components/ui/Dropdown';
import type { User } from '~/lib/auth';
import { controlPanelOpenStore, controlPanelInitialTabStore } from '~/lib/stores/settings';
import { profileStore } from '~/lib/stores/profile';

interface UserProfileProps {
  user: User | null;
}

export function UserProfile({ user }: UserProfileProps) {
  const submit = useSubmit();
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
    <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium border border-[#fed7aa]/60 dark:border-[#423322] bg-[#f0e4d5] dark:bg-[#372a1a] text-[#231710] dark:text-[#f0e4d5] hover:border-[#f97316] hover:bg-[#fed7aa] dark:hover:bg-[#423322] transition-colors">
      <div className="w-6 h-6 bg-[#f97316] rounded-full flex items-center justify-center text-white text-xs font-semibold">
        {displayInitial}
      </div>
      <span className="hidden md:block text-sm font-medium">{displayName || user.email}</span>
      <div className="i-ph:caret-down text-xs opacity-60" />
    </button>
  );

  return (
    <Dropdown trigger={trigger}>
      <div className="w-64 overflow-hidden rounded-xl border border-[#fed7aa]/60 dark:border-[#423322] bg-[#f0e4d5] dark:bg-[#2d2014] p-1.5 shadow-lg">
        <div className="px-2.5 py-2 border-b border-[#fed7aa]/40 dark:border-[#423322] flex items-center justify-between gap-2">
          {/*
           * min-w-0 is required: a flex item defaults to min-width:auto and refuses to shrink
           * below its content, so a long email pushes the tier badge outside the panel.
           */}
          <p className="min-w-0 truncate text-sm font-medium text-[#231710] dark:text-[#f0e4d5]" title={displayName}>
            {displayName || user.email}
          </p>
          {user.accountTier ? (
            <span className="shrink-0 rounded-full bg-[#f97316]/15 px-1.5 py-0.5 text-xs font-medium text-[#9a3412] dark:text-[#fdba74]">
              {user.accountTier}
            </span>
          ) : null}
        </div>

        {/* Only rendered for superadmins; /app/admin itself 404s for everyone else. */}
        {user.isSuperadmin && (
          <a
            href="/app/admin"
            className="flex items-center gap-2 px-2.5 py-2 text-sm w-full text-left text-[#231710]/70 dark:text-[#c4b19a] hover:bg-[#fed7aa]/50 dark:hover:bg-[rgba(240,228,213,0.08)] rounded-lg transition-colors"
          >
            <div className="i-ph:shield-star text-lg" />
            Admin
          </a>
        )}

        {user.isModerator && (
          <>
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-2 text-sm w-full text-left text-[#231710]/70 dark:text-[#c4b19a] hover:bg-[#fed7aa]/50 dark:hover:bg-[rgba(240,228,213,0.08)] rounded-lg transition-colors"
              onClick={() => controlPanelOpenStore.set(true)}
            >
              <div className="i-ph:gear text-lg" />
              Settings
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-2 text-sm w-full text-left text-[#231710]/70 dark:text-[#c4b19a] hover:bg-[#fed7aa]/50 dark:hover:bg-[rgba(240,228,213,0.08)] rounded-lg transition-colors"
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

        <div className="my-1 border-t border-[#fed7aa]/40 dark:border-[#423322]" />

        <DropdownItem asChild>
          <button
            type="button"
            onClick={() => submit(null, { method: 'post', action: '/auth/logout' })}
            className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left text-red-600 hover:text-red-700"
          >
            <div className="i-ph:sign-out text-lg" />
            Sign Out
          </button>
        </DropdownItem>
      </div>
    </Dropdown>
  );
}
