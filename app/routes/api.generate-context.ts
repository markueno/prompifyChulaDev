import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { DEFAULT_MODEL } from '~/utils/constants';
import { DEFAULT_PROVIDER } from '~/utils/constants.server';
import { LLMManager } from '~/lib/modules/llm/manager';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';
import { requireAuth } from '~/lib/auth';
import { extractBrandSignals, formatSignalsForPrompt, extractStylesheetUrls } from '~/lib/brand-signals.server';
import { fetchTextLimited, UnsafeUrlError, assertPublicHttpUrl } from '~/lib/safe-fetch.server';
import { getRenderConfig, renderPage, shouldRender, signalStrength } from '~/lib/render-page.server';

/**
 * How many of the page's stylesheets to read. Enough for a palette without crawling the site.
 *
 * extractStylesheetUrls ranks before slicing, so these slots go to the sheets likely to hold
 * design tokens rather than to whichever reset and carousel CSS the page happened to link first.
 */
const MAX_STYLESHEETS = 6;

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
Every hex in the signals is already normalised to \`#rrggbb\` — copy them exactly, never re-derive or adjust them.
Order of trust: the colour-resolving design tokens first (a token is the site stating its own palette), then meta theme-color, then "Brand colours, by weighted use".
The signals separate brand colours from neutrals. NEVER name a colour from the neutrals list as the primary, secondary or accent — those are greys used for text, borders and surfaces. Report them only as neutral/surface/border roles.
If no brand colours and no colour tokens were found, write exactly: "Not determinable from the landing page." Do not invent hex values.

## Typography
Named typefaces and where each is used (headings vs body vs mono).
Order of trust: @font-face families (the fonts the site actually ships), then Google Fonts, then the font-family list — fallbacks and icon fonts have already been stripped, so treat each name as a deliberate choice.
If none were found, write exactly: "Not determinable from the landing page."

## Visual Style
Overall feel — density, corner radius, shadow use, light/dark, imagery style. Ground each claim in a signal or in the copy.

## Applying This
3-5 bullets telling a developer how to apply the above when building an interface for this company.

Rules:
- Every colour and font you name MUST appear in the OBSERVED SIGNALS. Never guess.
- A colour's weight reflects how prominently it is used, not its importance alone — a high-weight colour on buttons and backgrounds is the primary; a low-weight one is a supporting accent.
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
        return await fetchTextLimited(href, { maxBytes: 700_000, timeoutMs: 8000 });
      } catch (err) {
        logger.debug(`Skipped stylesheet ${href}: ${err instanceof Error ? err.message : 'failed'}`);
        return '';
      }
    })
  );

  return sheets.join('\n');
}

/** One-line summary of what a pass found, so the two passes can be compared in the logs. */
function describeSignals(s: ReturnType<typeof extractBrandSignals>): string {
  return (
    `${s.cssVariables.filter(v => v.hex).length} colour tokens, ${s.colors.length} brand colours, ` +
    `${s.neutrals.length} neutrals, ${s.fontFaces.length} @font-face, ${s.fontFamilies.length} families, ` +
    `${s.googleFonts.length} google fonts, ${s.bodyText.length} chars copy`
  );
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
  let signals = extractBrandSignals(html, validatedUrl, externalCss);

  logger.info(`Static pass for ${validatedUrl}: ${describeSignals(signals)}`);

  /*
   * Fallback for sites that never ship CSS as CSS.
   *
   * A styled-components or emotion app injects its rules at runtime and a client-rendered page
   * serves an empty body, so a plain fetch sees neither the palette nor the copy. Rendering puts
   * both in the DOM, where the same extractor can read them.
   *
   * Only reached when the static pass actually left a gap, and only when a render service is
   * configured. The rendered pass has to beat the static one on evidence to be adopted: a consent
   * wall, a bot check or a failed hydration can leave less behind than the raw HTML did.
   */
  const renderConfig = getRenderConfig(context.cloudflare?.env as any);

  if (renderConfig && shouldRender(signals)) {
    const rendered = await renderPage(validatedUrl, renderConfig);

    if (rendered) {
      const renderedCss = await fetchStylesheets(rendered, validatedUrl);
      const renderedSignals = extractBrandSignals(rendered, validatedUrl, renderedCss);

      if (signalStrength(renderedSignals) > signalStrength(signals)) {
        logger.info(`Rendered pass adopted for ${validatedUrl}: ${describeSignals(renderedSignals)}`);
        signals = renderedSignals;
      } else {
        logger.info(`Rendered pass discarded for ${validatedUrl} — static evidence was stronger`);
      }
    }
  }

  /*
   * Thin copy alone is no longer fatal. A client-rendered marketing site can serve almost no text
   * in its HTML while still shipping a complete set of design tokens, and the palette and
   * typefaces are the parts of this document people actually use — returning 422 threw those away
   * over missing prose. Bail only when there is nothing of either kind to work from.
   */
  const hasDesignSignal =
    signals.colors.length > 0 || signals.cssVariables.some(v => v.hex) || signals.fontFaces.length > 0;

  if (signals.bodyText.length < 100 && !hasDesignSignal) {
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
