import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';
import { requireAuth } from '~/lib/auth';

export async function action(args: ActionFunctionArgs) {
  return generateContextAction(args);
}

const logger = createScopedLogger('api.generate-context');

const SYSTEM_PROMPT = `You are a technical analyst. Given the scraped text content of a website, produce a concise company context document in markdown format.

Include:
- Company name and industry
- What products or services they offer
- Their brand tone and visual style (based on the copy)
- Target audience or customer base
- Any notable features, integrations, or positioning

Keep it to 3-5 short paragraphs. Write in a neutral, factual tone. Do not invent details not found in the content.`;

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

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

  const html = await response.text();

  return stripHtml(html);
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

  let pageContent: string;

  try {
    pageContent = await fetchPageContent(validatedUrl);
  } catch (err) {
    logger.error('Fetch error:', err);
    return new Response(JSON.stringify({ error: 'Could not fetch the URL. Make sure it is a public website.' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!pageContent || pageContent.length < 100) {
    return new Response(JSON.stringify({ error: 'Could not extract enough content from the page.' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
