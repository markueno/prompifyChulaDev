import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireAuth } from '~/lib/auth';
import {
  getCompanyBySlug,
  getCompanyMember,
  getCompanyMembers,
  updateCompany,
  getAuditLogs,
} from '~/lib/database';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';
import { Card, CardContent, CardHeader } from '~/components/ui/Card';
import { ScrollArea } from '~/components/ui/ScrollArea';
import type { CompanyRole } from '~/lib/database';

interface LoaderData {
  company: { id: string; name: string; slug: string; github_org: string | null; plan: string };
  members: { user_id: string; email: string; role: CompanyRole; joined_at: string }[];
  auditLogs: { id: string; actor_email: string; project_name: string | null; action: string; payload: unknown; created_at: string }[];
  userRole: CompanyRole;
}

interface ActionData {
  error?: string;
  success?: string;
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const slug = params.slug!;

  const company = await getCompanyBySlug(slug);
  if (!company) throw redirect('/company/new');

  const member = await getCompanyMember(company.id, user.id);
  if (!member) throw new Response('Forbidden', { status: 403 });

  const [members, auditLogs] = await Promise.all([
    getCompanyMembers(company.id),
    getAuditLogs(company.id, 50),
  ]);

  return json<LoaderData>({
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      github_org: company.github_org,
      plan: company.plan,
    },
    members,
    auditLogs,
    userRole: member.role,
  });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  const slug = params.slug!;

  const company = await getCompanyBySlug(slug);
  if (!company) throw new Response('Not found', { status: 404 });

  const member = await getCompanyMember(company.id, user.id);
  if (!member || member.role !== 'admin') {
    return json<ActionData>({ error: 'Only admins can update company settings' });
  }

  const formData = await request.formData();
  const name = String(formData.get('name') ?? '').trim();
  const githubOrg = String(formData.get('githubOrg') ?? '').trim() || undefined;

  if (!name) {
    return json<ActionData>({ error: 'Company name is required' });
  }

  const success = await updateCompany(company.id, { name, github_org: githubOrg ?? '' });
  if (!success) {
    return json<ActionData>({ error: 'Failed to update settings' });
  }

  return json<ActionData>({ success: 'Settings saved' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export default function CompanySettings() {
  const { company, members, auditLogs, userRole } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isAdmin = userRole === 'admin';
  const submitting = navigation.state === 'submitting';

  return (
    <div className="min-h-screen bg-bolt-elements-background-depth-1">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link to={`/c/${company.slug}`} className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary text-sm">
            ← {company.name}
          </Link>
          <span className="text-bolt-elements-textTertiary">/</span>
          <span className="text-sm text-bolt-elements-textPrimary">Settings</span>
        </div>

        {/* General settings */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-bolt-elements-textPrimary">General</h2>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="name">Company name</Label>
                <Input id="name" name="name" defaultValue={company.name} disabled={!isAdmin} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="githubOrg">GitHub organization</Label>
                <Input
                  id="githubOrg"
                  name="githubOrg"
                  defaultValue={company.github_org ?? ''}
                  placeholder="acme-corp"
                  disabled={!isAdmin}
                />
                <p className="text-xs text-bolt-elements-textTertiary">
                  Generated app code is pushed here as private repos
                </p>
              </div>
              {actionData?.error && <p className="text-sm text-red-500">{actionData.error}</p>}
              {actionData?.success && <p className="text-sm text-green-500">{actionData.success}</p>}
              {isAdmin && (
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save settings'}
                </Button>
              )}
            </Form>
          </CardContent>
        </Card>

        {/* Members */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-bolt-elements-textPrimary">Members ({members.length})</h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between py-2 border-b border-bolt-elements-borderColor last:border-0">
                  <div>
                    <p className="text-sm text-bolt-elements-textPrimary">{m.email}</p>
                    <p className="text-xs text-bolt-elements-textTertiary">Joined {formatDate(m.joined_at)}</p>
                  </div>
                  <span className="text-xs capitalize text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2 px-2 py-1 rounded">
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Audit log */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-bolt-elements-textPrimary">Audit log</h2>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {auditLogs.length === 0 ? (
                  <p className="text-sm text-bolt-elements-textSecondary">No activity yet</p>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="flex items-start justify-between gap-4 py-1.5 border-b border-bolt-elements-borderColor/50 last:border-0">
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-bolt-elements-textPrimary">{log.action}</span>
                        {log.project_name && (
                          <span className="text-xs text-bolt-elements-textSecondary ml-1">· {log.project_name}</span>
                        )}
                        <span className="text-xs text-bolt-elements-textTertiary ml-1">by {log.actor_email}</span>
                      </div>
                      <span className="text-xs text-bolt-elements-textTertiary shrink-0">{formatDate(log.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
