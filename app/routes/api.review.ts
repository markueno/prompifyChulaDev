import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { ProviderInfo } from '~/types/model';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';
import { optionalAuth } from '~/lib/auth';

export async function action(args: ActionFunctionArgs) {
  return reviewAction(args);
}

export interface ReviewFile {
  path: string;
  content: string;
}

export interface ReviewIssue {
  file: string;
  line: number;
  message: string;
}

const logger = createScopedLogger('api.review');

const REVIEW_SYSTEM = `You are a senior code reviewer. Your only job is to find real bugs in the code shown — not style issues or preferences.

Bugs worth flagging:
- Undefined variables or missing imports
- Broken async/await (missing await, unhandled promise)
- React hook rule violations (hooks inside conditions/loops)
- window/document used without SSR guard in a server-rendered context
- Event listeners added without cleanup (missing return in useEffect)
- Obvious null/undefined dereference

Return ONLY a valid JSON array. Each element: {"file":"relative/path","line":N,"message":"concise one-line description"}.
Maximum 5 items. No prose, no markdown fences, just the raw JSON array.
If no bugs found, return an empty array: []`;

async function reviewAction({ context, request }: ActionFunctionArgs) {
  await optionalAuth(request, context);

  const body = await request.json<{
    files: ReviewFile[];
    model: string;
    provider: ProviderInfo;
  }>();

  const { files, model, provider } = body;

  if (!files?.length || !model || !provider) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  // Build the compact file listing (max 80 lines per file, max 3 files)
  const fileBlocks = files
    .slice(0, 3)
    .map(f => {
      const lines = f.content.split('\n').slice(0, 80);
      return `// === ${f.path} ===\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const userMessage = `Review these recently modified files:\n\n${fileBlocks}`;

  try {
    const llmManager = LLMManager.getInstance(import.meta.env);
    const allModels = await llmManager.updateModelList({
      apiKeys,
      providerSettings,
      serverEnv: context.cloudflare?.env as any,
    });

    let modelDetails: ModelInfo | undefined = allModels.find(m => m.name === model);

    if (!modelDetails) {
      modelDetails = allModels[0];
    }

    if (!modelDetails) {
      throw new Error('No models available');
    }

    const resolvedProviderName = modelDetails.provider || provider.name;
    const providerInfo = PROVIDER_LIST.find(p => p.name === resolvedProviderName) ?? PROVIDER_LIST[0];

    if (!providerInfo) {
      throw new Error('Provider not found');
    }

    logger.info(`Review: provider=${resolvedProviderName} model=${modelDetails.name} files=${files.length}`);

    const result = await generateText({
      system: REVIEW_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
      model: providerInfo.getModelInstance({
        model: modelDetails.name,
        serverEnv: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      }),
      // Keep it cheap — we only need a short JSON array
      maxTokens: 400,
      toolChoice: 'none',
    });

    // Parse and validate the JSON response
    let issues: ReviewIssue[] = [];

    try {
      // Strip any accidental markdown fences the model may have added
      const raw = result.text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        issues = parsed
          .filter(item => item && typeof item.file === 'string' && typeof item.message === 'string')
          .slice(0, 5)
          .map(item => ({
            file: String(item.file),
            line: Number(item.line) || 0,
            message: String(item.message).slice(0, 200),
          }));
      }
    } catch {
      logger.warn('Review response was not valid JSON, skipping');
    }

    return new Response(JSON.stringify(issues), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Review error:', error);

    if (error instanceof Error && error.message?.includes('API key')) {
      return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
