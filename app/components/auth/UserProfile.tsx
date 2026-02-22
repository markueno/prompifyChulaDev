import { useStore } from '@nanostores/react';
import { useRef } from 'react';
import { Button } from '~/components/ui/Button';
import { Dropdown, DropdownItem, DropdownSeparator } from '~/components/ui/Dropdown';
import type { User } from '~/lib/auth';
import { controlPanelOpenStore, controlPanelInitialTabStore } from '~/lib/stores/settings';
import { profileStore } from '~/lib/stores/profile';

interface UserProfileProps {
  user: User | null;
}

export function UserProfile({ user }: UserProfileProps) {
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const profile = useStore(profileStore);
  // Display name: nickname if set, otherwise auth email
  const displayName = (profile?.nickname?.trim() || user?.email || '').trim();
  const displayInitial = displayName ? displayName.charAt(0).toUpperCase() : (user?.email?.charAt(0).toUpperCase() ?? '');

  if (!user || !user.email) {
    return null;
  }

  const trigger = (
    <Button variant="ghost" className="flex items-center gap-2">
      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
        {displayInitial}
      </div>
      <span className="hidden md:block text-sm">{displayName || user.email}</span>
      <div className="i-ph:caret-down text-sm" />
    </Button>
  );

  return (
    <Dropdown trigger={trigger}>
      <div className="w-56">
        <div className="p-3 border-b border-bolt-elements-borderColor">
          <p className="text-sm font-medium text-bolt-elements-textPrimary">
            {displayName || user.email}
          </p>
          <p className="text-xs text-bolt-elements-textSecondary">
            {user.isVerified ? 'Verified Account' : 'Unverified Account'}
          </p>
        </div>

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

        <DropdownSeparator />

        <DropdownItem asChild onSelect={(e) => e.preventDefault()}>
          <form
            ref={logoutFormRef}
            action="/auth/logout"
            method="post"
            className="w-full"
            onSubmit={(e) => {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/60f7f86f-83e1-4fc6-9457-33ed06603dab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'UserProfile.tsx:form onSubmit',message:'Form submit fired',data:{formConnected:logoutFormRef.current?.isConnected??null},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
              // #endregion
            }}
          >
            <button
              type="submit"
              className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left text-red-600 hover:text-red-700"
              onClick={(e) => {
                // #region agent log
                const form = logoutFormRef.current;
                fetch('http://127.0.0.1:7242/ingest/60f7f86f-83e1-4fc6-9457-33ed06603dab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'UserProfile.tsx:button onClick',message:'Sign Out clicked',data:{formConnected:form?.isConnected??null,formInDoc:form?document.contains(form):null},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
                setTimeout(() => {
                  fetch('http://127.0.0.1:7242/ingest/60f7f86f-83e1-4fc6-9457-33ed06603dab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'UserProfile.tsx:setTimeout after click',message:'After microtask - form still connected?',data:{formConnected:form?.isConnected??null,formInDoc:form?document.contains(form):null},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
                }, 0);
                // #endregion
              }}
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