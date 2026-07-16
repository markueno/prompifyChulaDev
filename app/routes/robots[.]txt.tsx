import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

/*
 * /robots.txt — resource route.
 *
 * Allows all crawlers (Googlebot + the major AI crawlers: GPTBot, Google-Extended, ClaudeBot,
 * PerplexityBot, CCBot, anthropic-ai) and points them at the sitemap. No assets are blocked.
 * The explicit AI-crawler Allow matters for GEO (being cited by ChatGPT/Claude/Perplexity),
 * per the GEO-GUIDELINES "AI Crawler Accessibility" pillar.
 */
export function loader(_args: LoaderFunctionArgs): Response {
  const siteUrl = (process.env.SITE_URL || process.env.APP_URL || 'https://prompify.com').replace(/\/+$/, '');

  const body = `# prompify.com — robots.txt
# All crawlers allowed. Nothing is blocked.

User-agent: *
Allow: /

# --- AI crawlers (explicit allow so answers can cite prompify.com) ---
User-agent: GPTBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: CCBot
Allow: /

User-agent: anthropic-ai
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
