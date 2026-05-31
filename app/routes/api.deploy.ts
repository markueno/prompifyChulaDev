import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import crypto from 'crypto';
import type { NetlifySiteInfo } from '~/types/netlify';
import { optionalAuth } from '~/lib/auth';
import { updateAppStatus, addAuditLog } from '~/lib/database';
import { isSupabaseConfigured, schemaForChat } from '~/lib/supabase-provision.server';

interface DeployRequestBody {
  siteId?: string;
  files: Record<string, string>;
  chatId: string;
  projectId?: string;
  companyId?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const user = await optionalAuth(request, context);
    const { siteId, files, token, chatId, projectId, companyId } = (await request.json()) as DeployRequestBody & {
      token: string;
    };

    if (!token) {
      return json({ error: 'Not connected to Netlify' }, { status: 401 });
    }

    // Add debugging information
    console.log('[Deploy] Starting deployment for chatId:', chatId);
    console.log('[Deploy] Number of files to deploy:', Object.keys(files).length);
    console.log('[Deploy] File paths:', Object.keys(files).slice(0, 5)); // Log first 5 file paths

    let targetSiteId = siteId;
    let siteInfo: NetlifySiteInfo | undefined;

    // If no siteId provided, create a new site
    if (!targetSiteId) {
      const siteName = `bolt-diy-${chatId}-${Date.now()}`;
      const createSiteResponse = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: siteName,
          custom_domain: null,
        }),
      });

      if (!createSiteResponse.ok) {
        return json({ error: 'Failed to create site' }, { status: 400 });
      }

      const newSite = (await createSiteResponse.json()) as any;
      targetSiteId = newSite.id;
      siteInfo = {
        id: newSite.id,
        name: newSite.name,
        url: newSite.url,
        chatId,
      };
    } else {
      // Get existing site info
      if (targetSiteId) {
        const siteResponse = await fetch(`https://api.netlify.com/api/v1/sites/${targetSiteId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (siteResponse.ok) {
          const existingSite = (await siteResponse.json()) as any;
          siteInfo = {
            id: existingSite.id,
            name: existingSite.name,
            url: existingSite.url,
            chatId,
          };
        } else {
          targetSiteId = undefined;
        }
      }

      // If no siteId provided or site doesn't exist, create a new site
      if (!targetSiteId) {
        const siteName = `bolt-diy-${chatId}-${Date.now()}`;
        const createSiteResponse = await fetch('https://api.netlify.com/api/v1/sites', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: siteName,
            custom_domain: null,
          }),
        });

        if (!createSiteResponse.ok) {
          return json({ error: 'Failed to create site' }, { status: 400 });
        }

        const newSite = (await createSiteResponse.json()) as any;
        targetSiteId = newSite.id;
        siteInfo = {
          id: newSite.id,
          name: newSite.name,
          url: newSite.url,
          chatId,
        };
      }
    }

    // Inject Supabase env-config.js so deployed apps auto-connect to their schema
    const cfEnv = (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};

    if (chatId && isSupabaseConfigured(cfEnv)) {
      const supabaseUrl = (cfEnv.SUPABASE_URL as string) || process.env.SUPABASE_URL || '';
      const anonKey = (cfEnv.SUPABASE_ANON_KEY as string) || process.env.SUPABASE_ANON_KEY || '';
      const schema = schemaForChat(chatId);

      // Inject env-config.js
      const envConfigContent = `window.__PROMPIFY_CONFIG = ${JSON.stringify({
        supabaseUrl,
        supabaseAnonKey: anonKey,
        supabaseSchema: schema,
      })};`;
      files['env-config.js'] = envConfigContent;
      files['/env-config.js'] = envConfigContent;

      // Patch index.html to load env-config.js before any other scripts
      const indexKey = Object.keys(files).find(k => k === 'index.html' || k === '/index.html');

      if (indexKey && !files[indexKey].includes('env-config.js')) {
        files[indexKey] = files[indexKey].replace(/(<head[^>]*>)/i, '$1\n  <script src="/env-config.js"></script>');
      }
    }

    // Create file digests
    const fileDigests: Record<string, string> = {};

    for (const [filePath, content] of Object.entries(files)) {
      // Ensure file path starts with a forward slash
      const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
      const hash = crypto.createHash('sha1').update(content).digest('hex');
      fileDigests[normalizedPath] = hash;
    }

    // Create a new deploy with digests
    const deployResponse = await fetch(`https://api.netlify.com/api/v1/sites/${targetSiteId}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: fileDigests,
        async: true,
        skip_processing: false,
        draft: false, // Change this to false for production deployments
        function_schedules: [],
        required: Object.keys(fileDigests), // Add this line
        framework: null,
      }),
    });

    if (!deployResponse.ok) {
      return json({ error: 'Failed to create deployment' }, { status: 400 });
    }

    const deploy = (await deployResponse.json()) as any;
    let retryCount = 0;
    const maxRetries = 60;

    // Poll until deploy is ready for file uploads
    while (retryCount < maxRetries) {
      const statusResponse = await fetch(`https://api.netlify.com/api/v1/sites/${targetSiteId}/deploys/${deploy.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const status = (await statusResponse.json()) as any;

      if (status.state === 'prepared' || status.state === 'uploaded') {
        console.log('[Deploy] Starting file uploads for deploy:', deploy.id);

        // Upload all files regardless of required array
        for (const [filePath, content] of Object.entries(files)) {
          const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;

          console.log('[Deploy] Uploading file:', normalizedPath, 'Size:', content.length);

          let uploadSuccess = false;
          let uploadRetries = 0;

          while (!uploadSuccess && uploadRetries < 3) {
            try {
              const uploadResponse = await fetch(
                `https://api.netlify.com/api/v1/deploys/${deploy.id}/files${normalizedPath}`,
                {
                  method: 'PUT',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/octet-stream',
                  },
                  body: content,
                }
              );

              uploadSuccess = uploadResponse.ok;

              if (!uploadSuccess) {
                const errorText = await uploadResponse.text();
                console.error(
                  '[Deploy] Upload failed for:',
                  normalizedPath,
                  'Status:',
                  uploadResponse.status,
                  'Error:',
                  errorText
                );
                uploadRetries++;
                await new Promise(resolve => setTimeout(resolve, 2000));
              } else {
                console.log('[Deploy] Successfully uploaded:', normalizedPath);
              }
            } catch (error) {
              console.error('[Deploy] Upload error for:', normalizedPath, error);
              uploadRetries++;
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          if (!uploadSuccess) {
            return json({ error: `Failed to upload file ${filePath} after ${uploadRetries} retries` }, { status: 500 });
          }
        }

        console.log('[Deploy] All files uploaded successfully');
      }

      if (status.state === 'ready') {
        // Only return after files are uploaded
        if (Object.keys(files).length === 0 || status.summary?.status === 'ready') {
          console.log('[Deploy] Deployment completed successfully');

          const deployUrl = status.ssl_url || status.url;

          if (projectId && companyId && user) {
            await updateAppStatus(projectId, 'active', { deploy_url: deployUrl });
            await addAuditLog({
              companyId,
              actorId: user.id,
              projectId,
              action: 'DEPLOY',
              payload: { deploy_id: status.id, url: deployUrl },
              ipAddress: request.headers.get('x-forwarded-for'),
            });
          }

          return json({
            success: true,
            deploy: {
              id: status.id,
              state: status.state,
              url: deployUrl,
            },
            site: siteInfo,
          });
        }
      }

      if (status.state === 'error') {
        console.error('[Deploy] Deployment failed with state:', status.state, 'Error:', status.error_message);
        return json({ error: status.error_message || 'Deploy preparation failed' }, { status: 500 });
      }

      retryCount++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (retryCount >= maxRetries) {
      console.error('[Deploy] Deployment timed out after', maxRetries, 'attempts');
      return json({ error: 'Deploy preparation timed out' }, { status: 500 });
    }

    // If we reach here, something went wrong
    console.error('[Deploy] Deployment loop ended unexpectedly');

    return json({ error: 'Deployment failed - unexpected state' }, { status: 500 });
  } catch (error) {
    console.error('[Deploy] Deployment error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    return json({ error: `Deployment failed: ${errorMessage}` }, { status: 500 });
  }
}
