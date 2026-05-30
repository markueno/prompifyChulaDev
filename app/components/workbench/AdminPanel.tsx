import { memo, useState, useEffect, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { classNames } from '~/utils/classNames';
import { chatId } from '~/lib/persistence';
import { EventLogsTab } from '~/components/@settings/tabs/event-logs/EventLogsTab';
import { AdminSecuritySection } from '~/components/workbench/AdminSecuritySection';
import { AdminDataSection } from '~/components/workbench/AdminDataSection';
import { workbenchStore } from '~/lib/stores/workbench';

export type AdminSectionId =
  | 'overview'
  | 'users'
  | 'data'
  | 'analytics'
  | 'domains'
  | 'integrations'
  | 'security'
  | 'code'
  | 'agents'
  | 'automations'
  | 'logs'
  | 'api'
  | 'settings';

interface AdminNavItem {
  id: AdminSectionId;
  label: string;
  icon: string;
  beta?: boolean;
  expandable?: boolean;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'i-ph:squares-four' },
  { id: 'users', label: 'Users', icon: 'i-ph:users' },
  { id: 'data', label: 'Data', icon: 'i-ph:database', expandable: true },
  { id: 'analytics', label: 'Analytics', icon: 'i-ph:chart-bar', beta: true },
  { id: 'domains', label: 'Domains', icon: 'i-ph:globe' },
  { id: 'integrations', label: 'Integrations', icon: 'i-ph:plug' },
  { id: 'security', label: 'Security', icon: 'i-ph:shield-check' },
  { id: 'code', label: 'Code', icon: 'i-ph:code' },
  { id: 'agents', label: 'Agents', icon: 'i-ph:robot' },
  { id: 'automations', label: 'Automations', icon: 'i-ph:lightning' },
  { id: 'logs', label: 'Logs', icon: 'i-ph:file-text' },
  { id: 'api', label: 'API', icon: 'i-ph:brackets-curly' },
  { id: 'settings', label: 'Settings', icon: 'i-ph:gear', expandable: true },
];

const SECTION_TITLES: Record<AdminSectionId, string> = {
  overview: 'Overview',
  users: 'Users',
  data: 'Data',
  analytics: 'Analytics',
  domains: 'Domains',
  integrations: 'Integrations',
  security: 'Security',
  code: 'Code',
  agents: 'Agents',
  automations: 'Automations',
  logs: 'Logs',
  api: 'API',
  settings: 'Settings',
};

const SECTION_DESCRIPTIONS: Record<AdminSectionId, string> = {
  overview: 'High-level summary and key metrics of your application.',
  users: "Manage the project's users and their roles. Share the chat history, code, and preview with collaborators.",
  data: 'Access and manage your application data.',
  analytics: 'View performance metrics and insights.',
  domains: 'Manage web domains and network configurations.',
  integrations: 'Connect with external services and APIs.',
  security: 'Security settings, access controls, and logs.',
  code: 'Code snippets, custom scripts, and development tools.',
  agents: 'Manage automated agents and bots.',
  automations: 'Set up automated workflows and tasks.',
  logs: 'View system logs, activity history, and error reports.',
  api: 'Manage API keys, documentation, and endpoints.',
  settings: 'General application configuration and preferences.',
};

interface ChatMember {
  id: string;
  email: string;
  role: string;
}

interface ChatInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

const UsersSection = memo(() => {
  const currentChatId = useStore(chatId);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [invitations, setInvitations] = useState<ChatInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'pending'>('users');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [editMember, setEditMember] = useState<ChatMember | null>(null);
  const [editRole, setEditRole] = useState<string>('');
  const [updating, setUpdating] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<ChatMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentChatId) return;
    setLoading(true);
    try {
      const [membersRes, invitationsRes] = await Promise.all([
        fetch(`/api/chats/${currentChatId}/members`),
        fetch(`/api/chats/${currentChatId}/invitations`),
      ]);
      const membersData = await membersRes.json();
      const invitationsData = await invitationsRes.json();
      if (membersData.members) setMembers(membersData.members);
      if (membersData.currentUserRole) setCurrentUserRole(membersData.currentUserRole);
      if (invitationsData.invitations) setInvitations(invitationsData.invitations);
    } catch (err) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [currentChatId]);

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMember || !currentChatId || updating) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/chats/${currentChatId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateRole', targetUserId: editMember.id, role: editRole }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Role updated');
        setEditMember(null);
        fetchData();
      } else {
        toast.error(data.error || 'Failed to update role');
      }
    } catch {
      toast.error('Failed to update role');
    } finally {
      setUpdating(false);
    }
  };

  const handleRemove = async () => {
    if (!removeConfirm || !currentChatId || removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/chats/${currentChatId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', targetUserId: removeConfirm.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Member removed');
        setRemoveConfirm(null);
        fetchData();
      } else {
        toast.error(data.error || 'Failed to remove member');
      }
    } catch {
      toast.error('Failed to remove member');
    } finally {
      setRemoving(false);
    }
  };

  const canEditOrRemove = (member: ChatMember) => {
    if (member.role === 'owner') return false;
    if (currentUserRole === 'owner' || currentUserRole === 'moderator') return true;
    if (currentUserRole === 'admin') return member.role === 'member'; // admin can only edit/remove members
    return false;
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !currentChatId || inviting) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/chats/${currentChatId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.alreadyMember ? (data.message || 'This person already has access to the project.') : 'Invitation sent');
        setInviteEmail('');
        setInviteOpen(false);
        fetchData();
        if (data.token) {
          const base = typeof window !== 'undefined' ? window.location.origin : '';
          setLastInviteLink(`${base}/invite/accept?token=${data.token}`);
        }
      } else {
        toast.error(data.error || 'Failed to send invitation');
      }
    } catch {
      toast.error('Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const filteredMembers = members.filter(m => {
    const matchesSearch = !searchQuery || m.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || m.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const filteredInvitations = invitations.filter(inv =>
    !searchQuery || inv.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!currentChatId) {
    return (
      <div className="rounded-lg border border-dashed border-bolt-elements-borderColor p-12 text-center">
        <div className="i-ph:folder-open text-4xl text-bolt-elements-textTertiary mx-auto mb-3" />
        <p className="text-sm text-bolt-elements-textTertiary">
          Start a chat and generate some code to share this project with others.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex gap-2 border-b border-bolt-elements-borderColor">
          <button
            onClick={() => setActiveTab('users')}
            className={classNames(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'users'
                ? 'border-accent-500 text-bolt-elements-textPrimary'
                : 'border-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary'
            )}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={classNames(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'pending'
                ? 'border-accent-500 text-bolt-elements-textPrimary'
                : 'border-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary'
            )}
          >
            Pending requests
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-bolt-elements-background-depth-4 text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 transition-colors border border-bolt-elements-borderColor"
          >
            <div className="i-ph:user-plus" />
            Invite User
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search by Email or Name"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor focus:outline-none focus:ring-2 focus:ring-accent-500/50 text-bolt-elements-textPrimary"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 i-ph:magnifying-glass text-bolt-elements-textTertiary w-4 h-4" />
        </div>
        {activeTab === 'users' && (
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/50"
          >
            <option value="all">all roles</option>
            <option value="admin">admin</option>
            <option value="member">member</option>
          </select>
        )}
      </div>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !inviting && setInviteOpen(false)}>
          <div className="bg-bolt-elements-background-depth-2 rounded-xl shadow-xl border border-bolt-elements-borderColor p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-bolt-elements-textPrimary mb-4">Invite by email</h3>
            <form onSubmit={handleInvite}>
              <input
                type="email"
                placeholder="Enter email address"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                className="w-full px-3 py-2 mb-4 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                required
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => !inviting && setInviteOpen(false)} className="px-3 py-1.5 text-sm rounded-lg hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary">
                  Cancel
                </button>
                <button type="submit" disabled={inviting || !inviteEmail.trim()} className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
                  {inviting ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {lastInviteLink && (
        <div className="mt-4 p-3 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor">
          <p className="text-xs text-bolt-elements-textSecondary mb-2">Share this link with the invitee (they must be logged in with that email):</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={lastInviteLink}
              className="flex-1 px-2 py-1.5 text-xs rounded bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary truncate"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(lastInviteLink);
                toast.success('Link copied');
              }}
              className="px-2 py-1.5 text-xs rounded bg-accent-500 text-white hover:bg-accent-600 shrink-0"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {editMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !updating && setEditMember(null)}>
          <div className="bg-bolt-elements-background-depth-2 rounded-xl shadow-xl border border-bolt-elements-borderColor p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-bolt-elements-textPrimary">Edit User</h3>
              <button onClick={() => !updating && setEditMember(null)} className="p-2 rounded-lg hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary">
                <div className="i-ph:x w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateRole}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-1">role</label>
                <p className="text-xs text-bolt-elements-textTertiary mb-2">The role of the user in the app.</p>
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                  required
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
              </div>
              <button type="submit" disabled={updating} className="px-4 py-2 text-sm font-medium rounded-lg bg-bolt-elements-background-depth-4 text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 disabled:opacity-50">
                {updating ? 'Saving...' : 'Submit'}
              </button>
            </form>
          </div>
        </div>
      )}

      {removeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !removing && setRemoveConfirm(null)}>
          <div className="bg-bolt-elements-background-depth-2 rounded-xl shadow-xl border border-bolt-elements-borderColor p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-bolt-elements-textPrimary mb-2">Remove User</h3>
            <p className="text-sm text-bolt-elements-textSecondary mb-4">
              Are you sure you want to remove {removeConfirm.email} from this project? They will lose access to the chat history, code, and preview.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => !removing && setRemoveConfirm(null)} className="px-3 py-1.5 text-sm rounded-lg hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary">
                Cancel
              </button>
              <button onClick={handleRemove} disabled={removing} className="px-4 py-1.5 text-sm font-medium rounded-lg bg-red-500/20 text-red-500 hover:bg-red-500/30 disabled:opacity-50">
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-bolt-elements-borderColor overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-bolt-elements-textTertiary">
            <div className="i-ph:circle-notch animate-spin text-2xl mx-auto mb-2" />
            Loading...
          </div>
        ) : activeTab === 'users' ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bolt-elements-background-depth-1 border-b border-bolt-elements-borderColor">
                <th className="text-left px-4 py-3 font-medium text-bolt-elements-textPrimary">Name</th>
                <th className="text-left px-4 py-3 font-medium text-bolt-elements-textPrimary">Role</th>
                <th className="text-left px-4 py-3 font-medium text-bolt-elements-textPrimary">Email</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-bolt-elements-textTertiary">
                    No users found. Invite collaborators by email.
                  </td>
                </tr>
              ) : (
                filteredMembers.map(m => (
                  <tr key={m.id} className="border-b border-bolt-elements-borderColor last:border-0 hover:bg-bolt-elements-background-depth-1/50">
                    <td className="px-4 py-3 text-bolt-elements-textPrimary">
                      <span className="font-medium">{m.email.split('@')[0].replace(/[._]/g, ' ')}</span>
                      {m.role === 'owner' && <span className="block text-xs text-bolt-elements-textTertiary">Owner</span>}
                    </td>
                    <td className="px-4 py-3 text-bolt-elements-textSecondary">{m.role}</td>
                    <td className="px-4 py-3 text-bolt-elements-textSecondary">{m.email}</td>
                    <td className="px-4 py-3">
                      {canEditOrRemove(m) && (
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button className="p-1.5 rounded-lg hover:bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary">
                              <div className="i-ph:dots-three w-4 h-4" />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              className="min-w-[160px] rounded-lg p-2 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-lg z-[1000]"
                              sideOffset={4}
                              align="end"
                            >
                              <DropdownMenu.Item
                                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary outline-none"
                                onSelect={() => {
                                  setEditMember(m);
                                  setEditRole(m.role === 'owner' ? 'admin' : m.role);
                                }}
                              >
                                <div className="i-ph:pencil-simple w-4 h-4" />
                                Edit user
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-red-500/10 text-red-500 outline-none"
                                onSelect={() => setRemoveConfirm(m)}
                              >
                                <div className="i-ph:user-minus w-4 h-4" />
                                Remove user
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bolt-elements-background-depth-1 border-b border-bolt-elements-borderColor">
                <th className="text-left px-4 py-3 font-medium text-bolt-elements-textPrimary">Email</th>
                <th className="text-left px-4 py-3 font-medium text-bolt-elements-textPrimary">Role</th>
                <th className="text-left px-4 py-3 font-medium text-bolt-elements-textPrimary">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvitations.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-bolt-elements-textTertiary">
                    No pending invitations.
                  </td>
                </tr>
              ) : (
                filteredInvitations.map(inv => (
                  <tr key={inv.id} className="border-b border-bolt-elements-borderColor last:border-0 hover:bg-bolt-elements-background-depth-1/50">
                    <td className="px-4 py-3 text-bolt-elements-textPrimary">{inv.email}</td>
                    <td className="px-4 py-3 text-bolt-elements-textSecondary">{inv.role}</td>
                    <td className="px-4 py-3 text-bolt-elements-textSecondary">{inv.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

UsersSection.displayName = 'UsersSection';

export const AdminPanel = memo(() => {
  const activeSection = useStore(workbenchStore.adminPanelSection);
  const [expandedItems, setExpandedItems] = useState<Set<AdminSectionId>>(new Set());

  const toggleExpand = (id: AdminSectionId) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full bg-bolt-elements-background-depth-2">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex flex-col">
        <nav className="flex-1 overflow-y-auto py-2">
          {ADMIN_NAV_ITEMS.map(item => (
            <div key={item.id}>
              <button
                onClick={() => {
                  if (item.expandable) {
                    toggleExpand(item.id);
                  }
                  workbenchStore.adminPanelSection.set(item.id);
                }}
                className={classNames(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                  activeSection === item.id && !item.expandable
                    ? 'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary'
                    : 'text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2 hover:text-bolt-elements-textPrimary'
                )}
              >
                <div className={classNames('w-5 h-5 shrink-0', item.icon, 'text-bolt-elements-textSecondary')} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.beta && (
                  <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
                    Beta
                  </span>
                )}
                {item.expandable && (
                  <div
                    className={classNames(
                      'w-4 h-4 shrink-0 transition-transform',
                      expandedItems.has(item.id) ? 'rotate-180' : '',
                      'i-ph:caret-down text-bolt-elements-textTertiary'
                    )}
                  />
                )}
              </button>
              {item.expandable && expandedItems.has(item.id) && (
                <div className="pl-4 pb-1">
                  <button
                    onClick={() => workbenchStore.adminPanelSection.set(item.id)}
                    className={classNames(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-md',
                      activeSection === item.id
                        ? 'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary'
                        : 'text-bolt-elements-textTertiary hover:bg-bolt-elements-background-depth-2'
                    )}
                  >
                    {item.label}
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content area */}
      <main
        className={classNames(
          'flex-1 p-6',
          activeSection === 'logs'
            ? 'flex min-h-0 flex-col overflow-hidden'
            : 'overflow-auto'
        )}
      >
        <div
          className={classNames(
            activeSection === 'logs' ? 'flex min-h-0 flex-1 flex-col max-w-none w-full' : 'max-w-3xl'
          )}
        >
          {activeSection !== 'logs' ? (
            <>
              <h1 className="text-xl font-semibold text-bolt-elements-textPrimary mb-1">
                {SECTION_TITLES[activeSection]}
              </h1>
              <p className="text-sm text-bolt-elements-textSecondary mb-6">
                {SECTION_DESCRIPTIONS[activeSection]}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-bolt-elements-textPrimary mb-1">{SECTION_TITLES.logs}</h1>
              <p className="text-sm text-bolt-elements-textSecondary mb-4">
                Same as Settings → Event Logs (Bolt-style). Enable &quot;Event Logging&quot; under Settings → Features so
                logs are recorded.
              </p>
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1">
                <EventLogsTab />
              </div>
            </>
          )}
          {activeSection === 'users' ? (
            <UsersSection />
          ) : activeSection === 'logs' ? null : activeSection === 'security' ? (
            <AdminSecuritySection />
          ) : activeSection === 'data' ? (
            <AdminDataSection />
          ) : (
            <div className="rounded-lg border border-dashed border-bolt-elements-borderColor p-12 text-center">
              <div className="i-ph:folder-open text-4xl text-bolt-elements-textTertiary mx-auto mb-3" />
              <p className="text-sm text-bolt-elements-textTertiary">
                This section is empty. Configure {SECTION_TITLES[activeSection].toLowerCase()} when ready.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
});

AdminPanel.displayName = 'AdminPanel';
