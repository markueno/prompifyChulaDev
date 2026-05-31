import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

// Handle all HTTP methods
export async function action({ request, params }: ActionFunctionArgs) {
  return handleProxyRequest(request, params['*']);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return handleProxyRequest(request, params['*']);
}

async function handleProxyRequest(request: Request, path: string | undefined) {
  try {
    if (!path) {
      return json({ error: 'Invalid proxy URL format' }, { status: 400 });
    }

    // Extract hostname from path (everything before the first '/')
    const hostname = path.split('/')[0];

    // ✅ SSRF FIX: List of allowed Git provider hosts
    const allowedHosts = [
      'github.com',
      'api.github.com',
      'raw.githubusercontent.com',
      'gitlab.com',
      'api.gitlab.com',
      'bitbucket.org',
      'api.bitbucket.org',
    ];

    // ✅ SSRF FIX: Check if hostname is in allowed list
    const isAllowedHost = allowedHosts.some(host => hostname === host || hostname.endsWith('.' + host));

    if (!isAllowedHost) {
      console.warn(`[SSRF Protection] Blocked unauthorized host: ${hostname}`);
      return json(
        {
          error: 'Invalid host. Only GitHub, GitLab, and Bitbucket are allowed.',
        },
        { status: 403 }
      );
    }

    // ✅ SSRF FIX: Block private IPs and localhost attempts
    const blockedPatterns = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '169.254', // AWS/Huawei Cloud metadata service
      '10.', // Private IP range
      '172.16.', // Private IP range
      '172.17.', // Private IP range
      '172.18.', // Private IP range
      '172.19.', // Private IP range
      '172.20.', // Private IP range
      '172.21.', // Private IP range
      '172.22.', // Private IP range
      '172.23.', // Private IP range
      '172.24.', // Private IP range
      '172.25.', // Private IP range
      '172.26.', // Private IP range
      '172.27.', // Private IP range
      '172.28.', // Private IP range
      '172.29.', // Private IP range
      '172.30.', // Private IP range
      '172.31.', // Private IP range
      '192.168.', // Private IP range
    ];

    const isBlockedPattern = blockedPatterns.some(pattern => hostname === pattern || hostname.startsWith(pattern));

    if (isBlockedPattern) {
      console.warn(`[SSRF Protection] Blocked private/localhost IP: ${hostname}`);
      return json(
        {
          error: 'Private IPs and localhost are not allowed for security reasons.',
        },
        { status: 403 }
      );
    }

    const url = new URL(request.url);

    // Reconstruct the target URL
    const targetURL = `https://${path}${url.search}`;

    // ✅ SSRF FIX: Additional validation - parse URL to verify hostname matches
    let parsedURL: URL;

    try {
      parsedURL = new URL(targetURL);
    } catch (error) {
      return json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Double-check the parsed hostname matches our validation
    if (!allowedHosts.some(host => parsedURL.hostname === host || parsedURL.hostname.endsWith('.' + host))) {
      console.warn(`[SSRF Protection] URL parsing revealed blocked hostname: ${parsedURL.hostname}`);
      return json(
        {
          error: 'Invalid host after URL parsing',
        },
        { status: 403 }
      );
    }

    // Forward the request to the target URL
    const response = await fetch(targetURL, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),

        // Override host header with the target host
        host: new URL(targetURL).host,
      },
      body: ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer(),
    });

    // Create response with CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
    }

    // Forward the response with CORS headers
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Git proxy error:', error);
    return json({ error: 'Proxy error' }, { status: 500 });
  }
}
