import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

/*
 * /sitemap.xml — resource route. Lists the public, indexable marketing pages.
 * Builder/app routes (/app/*) are auth-gated and not included (not worth indexing).
 */
export function loader(_args: LoaderFunctionArgs): Response {
  const siteUrl = (process.env.SITE_URL || process.env.APP_URL || 'https://prompify.com').replace(/\/+$/, '');
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = ['/', '/about'];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    u => `  <url>
    <loc>${siteUrl}${u === '/' ? '/' : u}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${u === '/' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${u === '/' ? '1.0' : '0.8'}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
