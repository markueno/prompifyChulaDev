import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';
import { requireAuth } from '~/lib/auth';
import { extractBrandSignals, formatSignalsForPrompt } from '~/lib/brand-signals.server';

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
Named typefaces and where each is used (headings vs body vs mono). Take these from the font-family and Google Fonts signals. If none were found, say so.

## Visual Style
Overall feel — density, corner radius, shadow use, light/dark, imagery style. Ground each claim in a signal or in the copy.

## Applying This
3-5 bullets telling a developer how to apply the above when building an interface for this company.

Rules:
- Every colour and font you name MUST appear in the OBSERVED SIGNALS. Never guess.
- Be specific and concise. Aim for 400-700 words total.
- If a signal is missing, say it could not be determined rather than filling the gap.`;

async function fetchPageContent(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AlimaBot/1.0)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    throw new Error('URL does not point to an HTML page');
  }

  // Return the raw HTML — the head and inline CSS are where the palette and typefaces live.
  return response.text();
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
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }

    validatedUrl = parsed.toString();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
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

  const signals = extractBrandSignals(html, validatedUrl);

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
    const llmManager = LLMManager.getInstance(import.meta.env);
    const allModels = await llmManager.updateModelList({
      apiKeys,
      providerSettings,
      serverEnv: context.cloudflare?.env as any,
    });

    const modelDetails: ModelInfo | undefined = allModels[0];

    if (!modelDetails) {
      throw new Error('No models available');
    }

    const resolvedProviderName = modelDetails.provider || PROVIDER_LIST[0]?.name;
    const providerInfo = PROVIDER_LIST.find(p => p.name === resolvedProviderName) ?? PROVIDER_LIST[0];

    if (!providerInfo) {
      throw new Error('Provider not found');
    }

    logger.info(`Generate context: provider=${resolvedProviderName} model=${modelDetails.name}`);

    const result = await generateText({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Website URL: ${validatedUrl}\n\nScraped content:\n${pageContent}`,
        },
      ],
      model: providerInfo.getModelInstance({
        model: modelDetails.name,
        serverEnv: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      }),
      maxTokens: 800,
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
