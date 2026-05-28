import { Link, useFetcher } from '@remix-run/react';
import { Card, CardContent } from '~/components/ui/Card';
import { Badge } from '~/components/ui/Badge';
import { Button } from '~/components/ui/Button';
import { classNames } from '~/utils/classNames';
import type { CompanyApp, CompanyRole } from '~/lib/database';

const STATUS_CONFIG = {
  active:   { label: 'Active',    color: 'bg-green-500/10  text-green-500  border-green-500/20'  },
  sleeping: { label: 'Sleeping',  color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
  building: { label: 'Building',  color: 'bg-blue-500/10   text-blue-500   border-blue-500/20'   },
  draft:    { label: 'Draft',     color: 'bg-gray-500/10   text-gray-400   border-gray-500/20'   },
  failed:   { label: 'Failed',    color: 'bg-red-500/10    text-red-500    border-red-500/20'     },
} as const;

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface AppStatusCardProps {
  app: CompanyApp;
  companySlug: string;
  userRole: CompanyRole;
}

export function AppStatusCard({ app, companySlug, userRole }: AppStatusCardProps) {
  const wakeFetcher = useFetcher();
  const sleepFetcher = useFetcher();
  const canAct = userRole === 'admin' || userRole === 'developer';
  const cfg = STATUS_CONFIG[app.status] ?? STATUS_CONFIG.draft;

  const isWaking = wakeFetcher.state !== 'idle';
  const isSleeping = sleepFetcher.state !== 'idle';

  return (
    <Card className="flex flex-col gap-3 p-4 hover:border-bolt-elements-borderColorHover transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-bolt-elements-textPrimary truncate">{app.name}</h3>
          {app.description && (
            <p className="text-xs text-bolt-elements-textSecondary mt-0.5 truncate">{app.description}</p>
          )}
        </div>
        <Badge className={classNames('shrink-0 border', cfg.color)}>{cfg.label}</Badge>
      </div>

      <div className="text-xs text-bolt-elements-textTertiary">
        Last active: {formatRelativeTime(app.last_active_at)}
      </div>

      <CardContent className="p-0 flex flex-wrap gap-2">
        {app.deploy_url && (
          <a
            href={app.deploy_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-bolt-elements-textLink hover:underline"
          >
            Open app ↗
          </a>
        )}
        {app.github_repo && (
          <a
            href={app.github_repo}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-bolt-elements-textLink hover:underline"
          >
            GitHub ↗
          </a>
        )}
      </CardContent>

      {canAct && (
        <div className="flex gap-2 pt-1 border-t border-bolt-elements-borderColor">
          {app.status === 'sleeping' && (
            <wakeFetcher.Form method="post" action={`/api/apps/${app.id}/wake`}>
              <Button size="sm" variant="outline" type="submit" disabled={isWaking}>
                {isWaking ? 'Waking…' : 'Wake'}
              </Button>
            </wakeFetcher.Form>
          )}
          {app.status === 'active' && (
            <sleepFetcher.Form method="post" action={`/api/apps/${app.id}/sleep`}>
              <Button size="sm" variant="outline" type="submit" disabled={isSleeping}>
                {isSleeping ? 'Sleeping…' : 'Sleep'}
              </Button>
            </sleepFetcher.Form>
          )}
          {app.status === 'draft' && (
            <Link to={`/app?companyId=${companySlug}&projectId=${app.id}`}>
              <Button size="sm" variant="outline">Build</Button>
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
