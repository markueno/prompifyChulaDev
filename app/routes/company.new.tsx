import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { useState } from 'react';
import { requireAuth } from '~/lib/auth';
import { createCompany, getCompanyBySlug, addAuditLog } from '~/lib/database';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardHeader } from '~/components/ui/Card';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';

interface ActionData {
  error?: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAuth(request, context);
  return json({});
}

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  const formData = await request.formData();
  const name = String(formData.get('name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim();
  const githubOrg = String(formData.get('githubOrg') ?? '').trim() || undefined;

  if (!name || !slug) {
    return json<ActionData>({ error: 'Company name and slug are required' });
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return json<ActionData>({ error: 'Slug must be lowercase letters, numbers, and hyphens only' });
  }

  const existing = await getCompanyBySlug(slug);

  if (existing) {
    return json<ActionData>({ error: 'A company with that slug already exists. Please choose another.' });
  }

  const company = await createCompany(name, slug, user.id, githubOrg);

  if (!company) {
    return json<ActionData>({ error: 'Failed to create company. Please try again.' });
  }

  await addAuditLog({
    companyId: company.id,
    actorId: user.id,
    action: 'CREATE_COMPANY',
    payload: { name, slug },
    ipAddress: request.headers.get('x-forwarded-for'),
  });

  return redirect(`/c/${slug}`);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function NewCompanyPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [slug, setSlug] = useState('');
  const [nameValue, setNameValue] = useState('');
  const submitting = navigation.state === 'submitting';

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setNameValue(v);
    setSlug(slugify(v));
  }

  return (
    <div className="min-h-screen bg-bolt-elements-background-depth-1 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-semibold text-bolt-elements-textPrimary">Create your company workspace</h1>
          <p className="text-sm text-bolt-elements-textSecondary mt-1">
            Your workspace is where your team builds and manages all your apps.
          </p>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">Company name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Acme Corp"
                value={nameValue}
                onChange={handleNameChange}
                required
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="slug">Workspace URL</Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-bolt-elements-textSecondary whitespace-nowrap">prompify.app/c/</span>
                <Input
                  id="slug"
                  name="slug"
                  placeholder="acme-corp"
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  required
                  pattern="[a-z0-9-]+"
                />
              </div>
              <p className="text-xs text-bolt-elements-textTertiary">Lowercase letters, numbers, and hyphens only</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="githubOrg">GitHub organization (optional)</Label>
              <Input id="githubOrg" name="githubOrg" placeholder="acme-corp" />
              <p className="text-xs text-bolt-elements-textTertiary">
                Generated app code will be pushed to repos in this org
              </p>
            </div>

            {actionData?.error && <p className="text-sm text-red-500">{actionData.error}</p>}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Creating workspace…' : 'Create workspace'}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
