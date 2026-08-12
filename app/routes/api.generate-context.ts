import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';
import { requireAuth } from '~/lib/auth';
import { extractBrandSignals, formatSignalsForPrompt, extractStylesheetUrls } from '~/lib/brand-signals.server';
import { fetchTextLimited, UnsafeUrlError, assertPublicHttpUrl } from '~/lib/safe-fetch.server';

/** How many of the page's stylesheets to read. Enough for a palette without crawling the site. */
const MAX_STYLESHEETS = 4;

export async function action(args: ActionFunctionArgs) {
  return generateContextAction(args);
}

const logger = createScopedLogger('api.generate-context');

const SYSTEM_PROMPT = `You are a brand and design analyst. You are given signals extracted from a company's landing page (CSS custom properties, colours, fonts, meta tags) plus the page copy. Produce a BRAND & DESIGN CONTEXT document in markdown that another AI will use to build software matching this company's identity.

Use exactly these sections:

# Brand & Design Context — <Company Name>

## Company
Industry, what they sell, who for, and their positioning. 2-3 sentences.

## Voice & Tone
How they write — formal/casual, technical/plain, playful/serious. Quote 1-2 short phrases from the copy as evidence.

## Colour Palette
List concrete colours with roles and hex values, e.g. "- Primary (\`#f97316\`): CTAs and active states".
Derive these from the OBSERVED SIGNALS. Prefer CSS custom properties, then theme-color, then the most frequent colours.
If the signals contain no usable colours, write exactly: "Not determinable from the landing page." Do not invent hex values.

## Typography
Named typefaces and where each is used (headings vs body vs mono).
Prefer the @font-face list — those are the fonts the site actually ships. Then Google Fonts, then the first named family in each font-family stack (ignore generic fallbacks like sans-serif, Arial, system-ui).
If none were found, write exactly: "Not determinable from the landing page."

## Visual Style
Overall feel — density, corner radius, shadow use, light/dark, imagery style. Ground each claim in a signal or in the copy.

## Applying This
3-5 bullets telling a developer how to apply the above when building an interface for this company.

Rules:
- Every colour and font you name MUST appear in the OBSERVED SIGNALS. Never guess.
- Be specific and concise. Aim for 400-700 words total.
- If a signal is missing, say it could not be determined rather than filling the gap.`;

/** Raw HTML — the head and inline CSS are where the palette and typefaces live. */
async function fetchPageContent(url: string): Promise<string> {
  return fetchTextLimited(url, {
    maxBytes: 1_500_000,
    timeoutMs: 15000,
    contentTypes: ['text/html', 'application/xhtml+xml'],
  });
}

/**
 * Fetch the page's stylesheets so the palette and @font-face rules are visible.
 *
 * Bounded on purpose: a handful of sheets, each size- and time-capped, fetched in parallel and
 * individually fault-tolerant. One slow or missing stylesheet must not fail the whole request —
 * partial CSS still produces a better document than none.
 */
async function fetchStylesheets(html: string, pageUrl: string): Promise<string> {
  const urls = extractStylesheetUrls(html, pageUrl, MAX_STYLESHEETS);

  if (urls.length === 0) {
    return '';
  }

  const sheets = await Promise.all(
    urls.map(async href => {
      try {
        return await fetchTextLimited(href, { maxBytes: 400_000, timeoutMs: 8000 });
      } catch (err) {
        logger.debug(`Skipped stylesheet ${href}: ${err instanceof Error ? err.message : 'failed'}`);
        return '';
      }
    })
  );

  return sheets.join('\n');
}

async function generateContextAction({ context, request }: ActionFunctionArgs) {
  await requireAuth(request, context);

  const body = await request.json<{ url: string }>();
  const { url } = body;

  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ error: 'URL is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let validatedUrl: string;

  try {
    validatedUrl = assertPublicHttpUrl(url).toString();
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof UnsafeUrlError ? err.message : 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let html: string;

  try {
    html = await fetchPageContent(validatedUrl);
  } catch (err) {
    logger.error('Fetch error:', err);
    return new Response(JSON.stringify({ error: 'Could not fetch the URL. Make sure it is a public website.' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const externalCss = await fetchStylesheets(html, validatedUrl);
  const signals = extractBrandSignals(html, validatedUrl, externalCss);

  logger.info(
    `Signals for ${validatedUrl}: ${signals.cssVariables.length} vars, ${signals.colors.length} colours, ` +
      `${signals.fontFaces.length} @font-face, ${signals.googleFonts.length} google fonts`
  );

  if (signals.bodyText.length < 100) {
    return new Response(JSON.stringify({ error: 'Could not extract enough content from the page.' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pageContent = formatSignalsForPrompt(signals);

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  try {
    /*
     * Use the same default the main chat uses (api.chat.ts), not allModels[0].
     * updateModelList returns every model from every registered provider — on this deployment
     * that list starts with ~400 OpenRouter models, so taking the first one picked a provider
     * with no API key configured and every request failed with "Missing API key for OpenRouter".
     */
    const llmManager = LLMManager.getInstance(import.meta.env);
    await llmManager.updateModelList({
      apiKeys,
      providerSettings,
      serverEnv: context.cloudflare?.env as any,
    });

    const providerInfo = DEFAULT_PROVIDER;
    const modelName = DEFAULT_MODEL;

    if (!providerInfo) {
      throw new Error('Provider not found');
    }

    logger.info(`Generate context: provider=${providerInfo.name} model=${modelName}`);

    const result = await generateText({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Website URL: ${validatedUrl}\n\nScraped content:\n${pageContent}`,
        },
      ],
      model: providerInfo.getModelInstance({
        model: modelName,
        serverEnv: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      }),
      // 400-700 words of markdown is ~900-1400 tokens; 800 truncated the document mid-section.
      maxTokens: 1800,
      toolChoice: 'none',
    });

    return new Response(JSON.stringify({ context: result.text.trim() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Generate context error:', error);

    if (error instanceof Error && error.message?.includes('API key')) {
      return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Failed to generate context' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
