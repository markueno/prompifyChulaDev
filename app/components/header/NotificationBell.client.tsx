import { useState, useEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useFetcher } from '@remix-run/react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '~/components/ui/Button';
import { classNames } from '~/utils/classNames';

interface Invitation {
  id: string;
  chat_id: string;
  token: string;
  role: string;
  created_at: string;
  project_name: string;
  inviter_email: string;
}

type Tab = 'notifications' | 'news';

export function NotificationBell() {
  const fetcher = useFetcher<{ invitations: Invitation[] }>();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('notifications');
  const invitations = fetcher.data?.invitations ?? [];

  const fetchInvitations = () => {
    fetcher.load('/api/invitations');
  };

  useEffect(() => {
    fetchInvitations();
  }, []);

  useEffect(() => {
    if (open) {
      fetchInvitations();
    }
  }, [open]);

  const trigger = (
    <DropdownMenu.Trigger asChild>
      <Button variant="ghost" size="icon" className="relative text-zinc-900 hover:text-black">
        <div className="i-ph:bell text-xl" />
        {invitations.length > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-medium text-white"
            aria-label={`${invitations.length} pending invitations`}
          >
            {invitations.length > 9 ? '9+' : invitations.length}
          </span>
        )}
      </Button>
    </DropdownMenu.Trigger>
  );

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      {trigger}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={classNames(
            'min-w-[320px] rounded-lg overflow-hidden',
            'bg-bolt-elements-background-depth-2',
            'border border-bolt-elements-borderColor',
            'shadow-lg',
            'animate-in fade-in-80 zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2',
            'z-[1000]'
          )}
          sideOffset={8}
          align="end"
        >
          <div className="border-b border-bolt-elements-borderColor">
            <div className="flex">
              <button
                type="button"
                onClick={() => setActiveTab('notifications')}
                className={classNames(
                  'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                  activeTab === 'notifications'
                    ? 'text-bolt-elements-textPrimary border-b-2 border-bolt-elements-textPrimary -mb-px'
                    : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary'
                )}
              >
                Notifications
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('news')}
                className={classNames(
                  'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                  activeTab === 'news'
                    ? 'text-bolt-elements-textPrimary border-b-2 border-bolt-elements-textPrimary -mb-px'
                    : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary'
                )}
              >
                Latest news
              </button>
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto p-2">
            {activeTab === 'news' ? (
              <div className="py-8 text-center text-sm text-bolt-elements-textSecondary">
                No news at the moment
              </div>
            ) : fetcher.state === 'loading' && invitations.length === 0 ? (
              <div className="py-8 text-center text-sm text-bolt-elements-textSecondary">
                Loading...
              </div>
            ) : invitations.length === 0 ? (
              <div className="py-8 text-center text-sm text-bolt-elements-textSecondary">
                No invitations
              </div>
            ) : (
              <div className="space-y-1">
                {invitations.map((inv) => (
                  <a
                    key={inv.id}
                    href={`/invite/accept?token=${inv.token}`}
                    className="block p-3 rounded-lg hover:bg-bolt-elements-background-depth-3 transition-colors text-left"
                  >
                    <p className="text-sm font-medium text-bolt-elements-textPrimary">
                      You're Invited to {inv.project_name} as {inv.role === 'admin' ? 'an Admin' : inv.role === 'member' ? 'a Member' : `a ${inv.role}`}
                    </p>
                    <p className="text-xs text-bolt-elements-textSecondary mt-0.5">
                      Accept the invitation whenever you're ready.
                    </p>
                    <p className="text-xs text-bolt-elements-textSecondary mt-1">
                      {formatDistanceToNow(new Date(inv.created_at), { addSuffix: true })}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
