import { Form } from '@remix-run/react';
import { Button } from '~/components/ui/Button';
import { Dropdown, DropdownItem, DropdownSeparator } from '~/components/ui/Dropdown';
import type { User } from '~/lib/auth';

interface UserProfileProps {
  user: User;
}

export function UserProfile({ user }: UserProfileProps) {
  const trigger = (
    <Button variant="ghost" className="flex items-center gap-2">
      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
        {user.email.charAt(0).toUpperCase()}
      </div>
      <span className="hidden md:block text-sm">{user.email}</span>
      <div className="i-ph:caret-down text-sm" />
    </Button>
  );

  return (
    <Dropdown trigger={trigger}>
      <div className="w-56">
        <div className="p-3 border-b border-bolt-elements-borderColor">
          <p className="text-sm font-medium text-bolt-elements-textPrimary">
            {user.email}
          </p>
          <p className="text-xs text-bolt-elements-textSecondary">
            {user.verified ? 'Verified Account' : 'Unverified Account'}
          </p>
        </div>

        <DropdownSeparator />

        <DropdownItem asChild>
          <a href="/settings" className="flex items-center gap-2 px-3 py-2 text-sm">
            <div className="i-ph:gear text-lg" />
            Settings
          </a>
        </DropdownItem>

        <DropdownItem asChild>
          <a href="/profile" className="flex items-center gap-2 px-3 py-2 text-sm">
            <div className="i-ph:user text-lg" />
            Profile
          </a>
        </DropdownItem>

        <DropdownSeparator />

        <DropdownItem asChild>
          <Form action="/auth/logout" method="post" className="w-full">
            <button className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left text-red-600 hover:text-red-700">
              <div className="i-ph:sign-out text-lg" />
              Sign Out
            </button>
          </Form>
        </DropdownItem>
      </div>
    </Dropdown>
  );
} 