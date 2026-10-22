import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import crypto from 'crypto';
import type { NetlifySiteInfo } from '~/types/netlify';
import { requireAuth } from '~/lib/auth';
import { updateAppStatus, addAuditLog } from '~/lib/database';
import { issueDataApiToken } from '~/lib/.server/data-token';

interface DeployRequestBody {
  siteId?: string;
  files: Record<string, string>;
  chatId: string;
  projectId?: string;
  companyId?: string;
  share?: boolean;
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const { siteId, files, token, chatId, projectId, companyId, share } =
      (await request.json()) as DeployRequestBody & {
        token: string;
      };

    if (!token) {
      return json({ error: 'Not connected to Netlify' }, { status: 401 });
    }

    /*
     * Some templates build with Vite SSR / React Router / Astro layouts: dist/client (browser
     * files) + dist/server (server bundle). A static host can only serve the client half, and the
     * server bundle must never be published. If the client half has its own index.html, deploy it
     * as the site root.
     */
    const hasRootIndex = Object.keys(files).some(k => k === 'index.html' || k === '/index.html');
    const hasClientIndex = Object.keys(files).some(k => k === 'client/index.html' || k === '/client/index.html');

    if (!hasRootIndex && hasClientIndex) {
      const clientOnly: Record<string, string> = {};

      for (const [filePath, content] of Object.entries(files)) {
        const normalized = filePath.startsWith('/') ? filePath : '/' + filePath;

        if (normalized.startsWith('/client/')) {
          clientOnly[normalized.slice('/client'.length)] = content;
        }
      }

      console.log('[Deploy] SSR-style build detected; deploying dist/client as the site root');

      for (const key of Object.keys(files)) {
        delete files[key];
      }

      Object.assign(files, clientOnly);
    } else if (!hasRootIndex && Object.keys(files).some(k => /^\/?server\//.test(k))) {
      return json(
        {
          error:
            'This app is built for server-side rendering (client/ + server/ with no index.html), which a static host cannot run. It needs a static (SPA) build before it can be deployed.',
        },
        { status: 400 }
      );
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

    /*
     * Inject env-config.js so deployed apps connect to the Prompify data proxy
     * (self-hosted, no Supabase). The token is short-lived (15 min) for normal
     * deploys — a proper refresh-on-401 flow is a hardening task. When share:true
     * is passed (the user explicitly clicked "Share"), issue a 7-day token so the
     * shared URL stays functional for more than a quick demo.
     */
    const cfEnv = (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};

    if (chatId) {
      /*
       * The deployed app runs on another host (e.g. *.netlify.app), so apiUrl MUST be absolute.
       * A relative '/api/data' resolves against the deploy host and 404s. Fall back to APP_URL
       * (set in docker-compose.prod.yaml) when PROMPIFY_PUBLIC_URL is not configured.
       */
      const publicUrl =
        (cfEnv.PROMPIFY_PUBLIC_URL as string) ||
        process.env.PROMPIFY_PUBLIC_URL ||
        (cfEnv.APP_URL as string) ||
        process.env.APP_URL ||
        '';

      if (!publicUrl) {
        return json(
          { error: 'Server misconfigured: set PROMPIFY_PUBLIC_URL so deployed apps can reach the data proxy' },
          { status: 500 }
        );
      }

      const apiUrl = `${publicUrl.replace(/\/$/, '')}/api/data`;

      let token = '';

      try {
        const envForToken = cfEnv as Record<string, unknown>;

        if (user?.id) {
          /*
           * Deployed apps are long-lived; a 15-min token makes their data 401 almost at once.
           * Same lifetime as Share until per-app revocable tokens exist. Override with
           * DEPLOY_DATA_TOKEN_TTL (e.g. '30d'). NOTE: the token is readable in the public page.
           */
          const deployTtl = (cfEnv.DEPLOY_DATA_TOKEN_TTL as string) || process.env.DEPLOY_DATA_TOKEN_TTL || '7d';
          token = issueDataApiToken(user.id, chatId, envForToken, share ? '7d' : deployTtl);
        }
      } catch {
        // token stays empty — the in-IDE preview still works via cookie
      }

      const envConfigContent = `window.__PROMPIFY_CONFIG = ${JSON.stringify({
        apiUrl,
        chatId,
        token,
      })};`;
      files['env-config.js'] = envConfigContent;
      files['/env-config.js'] = envConfigContent;

      // Patch index.html to load env-config.js before any other scripts
      const indexKey = Object.keys(files).find(k => k === 'index.html' || k === '/index.html');

      if (indexKey && !files[indexKey].includes('env-config.js')) {
        files[indexKey] = files[indexKey].replace(/(<head[^>]*>)/i, '$1\n  <script src="/env-config.js"></script>');
      }
    }

    // Inject generator meta tag for attribution (all deploys)
    const metaIndexKey = Object.keys(files).find(k => k === 'index.html' || k === '/index.html');

    if (metaIndexKey && !files[metaIndexKey].includes('name="generator"')) {
      files[metaIndexKey] = files[metaIndexKey].replace(
        '</head>',
        '  <meta name="generator" content="Prompify">\n  </head>'
      );
    }

    /*
     * Single-page-app fallback. Generated apps route in the browser, so a deep link or a refresh
     * on /deals asks Netlify for a file that does not exist and gets a 404. Netlify's documented
     * fix is the rewrite '/*  /index.html  200'; real files (assets, env-config.js) are still
     * served first because Netlify never shadows an existing file. Keep any rules the app ships
     * and add ours last, as Netlify recommends for this catch-all.
     * https://docs.netlify.com/manage/routing/redirects/rewrites-proxies
     */
    const SPA_FALLBACK_RULE = '/*  /index.html  200';
    const redirectsKey = Object.keys(files).find(k => k === '_redirects' || k === '/_redirects');

    if (!redirectsKey) {
      files['/_redirects'] = `${SPA_FALLBACK_RULE}\n`;
    } else if (!/\/index\.html\s+200/.test(files[redirectsKey])) {
      files[redirectsKey] = `${files[redirectsKey].replace(/\s*$/, '')}\n${SPA_FALLBACK_RULE}\n`;
    }

    /*
     * Normalise to one entry per served path. The map can hold the same file under two keys
     * ('env-config.js' and '/env-config.js'); uploading it twice made the second PUT land after
     * Netlify had started processing the deploy, which failed with "Failed to upload file
     * /env-config.js after 3 retries". Later keys win, so the injected env-config.js is kept.
     */
    const deployFiles: Record<string, string> = {};

    for (const [filePath, content] of Object.entries(files)) {
      deployFiles[filePath.startsWith('/') ? filePath : '/' + filePath] = content;
    }

    /*
     * A static host serves '/' from '/index.html'. Without it Netlify still publishes the deploy and
     * every URL is a 404, so refuse here with something the user can act on.
     */
    if (!deployFiles['/index.html']) {
      const topLevel = [...new Set(Object.keys(deployFiles).map(p => p.split('/')[1]))].slice(0, 15);
      console.error('[Deploy] No /index.html in build output. Top-level entries:', topLevel);

      return json(
        {
          error: `Build output has no index.html at its root (found: ${topLevel.join(', ') || 'nothing'}). The app may build to a different folder than dist/.`,
        },
        { status: 400 }
      );
    }

    const fileDigests: Record<string, string> = {};

    for (const [normalizedPath, content] of Object.entries(deployFiles)) {
      fileDigests[normalizedPath] = crypto.createHash('sha1').update(content).digest('hex');
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
        draft: false,
        function_schedules: [],
        framework: null,
      }),
    });

    if (!deployResponse.ok) {
      const errorText = await deployResponse.text().catch(() => '');
      console.error('[Deploy] Create deploy failed:', deployResponse.status, errorText);

      return json({ error: `Failed to create deployment (${deployResponse.status})` }, { status: 400 });
    }

    const deploy = (await deployResponse.json()) as any;
    let retryCount = 0;
    const maxRetries = 60;
    let filesUploaded = false;

    // Poll until the deploy is ready for uploads, upload ONCE, then wait for "ready".
    while (retryCount < maxRetries) {
      const statusResponse = await fetch(`https://api.netlify.com/api/v1/sites/${targetSiteId}/deploys/${deploy.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const status = (await statusResponse.json()) as any;

      if (
        !filesUploaded &&
        (status.state === 'prepared' || status.state === 'uploading' || status.state === 'uploaded')
      ) {
        /*
         * Netlify lists, by SHA1, only the files it does not already have. Upload exactly those,
         * one file per SHA ("If you have two files with the same SHA1, you don't have to upload
         * both"). Once the last required file lands, Netlify starts processing; any further PUT fails.
         */
        const required = new Set<string>([
          ...((deploy.required ?? []) as string[]),
          ...((status.required ?? []) as string[]),
        ]);
        const sentShas = new Set<string>();

        console.log(`[Deploy] Uploading ${required.size} required of ${Object.keys(deployFiles).length} files`);

        for (const [normalizedPath, content] of Object.entries(deployFiles)) {
          const sha = fileDigests[normalizedPath];

          if (!required.has(sha) || sentShas.has(sha)) {
            continue;
          }

          sentShas.add(sha);

          let uploadSuccess = false;
          let uploadRetries = 0;
          let lastError = '';

          while (!uploadSuccess && uploadRetries < 3) {
            try {
              const uploadResponse = await fetch(
                `https://api.netlify.com/api/v1/deploys/${deploy.id}/files${encodeURI(normalizedPath)}`,
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
                lastError = `${uploadResponse.status} ${await uploadResponse.text().catch(() => '')}`.trim();
                console.error('[Deploy] Upload failed for:', normalizedPath, lastError);
                uploadRetries++;
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              console.error('[Deploy] Upload error for:', normalizedPath, error);
              uploadRetries++;
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          if (!uploadSuccess) {
            return json(
              { error: `Failed to upload file ${normalizedPath} after ${uploadRetries} retries: ${lastError}` },
              { status: 500 }
            );
          }
        }

        filesUploaded = true;
        console.log('[Deploy] All required files uploaded');
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
