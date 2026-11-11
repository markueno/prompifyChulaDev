import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

/** DeepSeek - OpenAI compatible API. Base URL is the same for every V4 model. */
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/*
 * DeepSeek V4 models default to "thinking" ON. While reasoning, the API streams only
 * `reasoning_content` deltas, which the OpenAI-compatible SDK drops — the same failure that
 * made Qwen sit on "Generating Response" for minutes (see providers/qwen.ts). Disable it by
 * injecting `thinking: { type: 'disabled' }` into the request body after the SDK serializes it.
 *
 * The response body is also re-wrapped through globalThis.ReadableStream for the same
 * cross-realm instanceof reason documented in qwen.ts.
 */
const disableThinkingFetch: typeof globalThis.fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const payload = JSON.parse(init.body);

      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        payload.thinking = { type: 'disabled' };
        init = { ...init, body: JSON.stringify(payload) };
      }
    } catch {
      // Body isn't JSON we can parse — forward it untouched.
    }
  }

  const r = await globalThis.fetch(input, init);

  if (!r.body) {
    return r;
  }

  const reader = r.body.getReader();
  const fixedBody = new globalThis.ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
    cancel(reason) {
      reader.cancel(reason);
    },
  });

  return new globalThis.Response(fixedBody, {
    headers: r.headers,
    status: r.status,
    statusText: r.statusText,
  });
};

export default class DeepseekProvider extends BaseProvider {
  name = 'Deepseek';
  getApiKeyLink = 'https://platform.deepseek.com/apiKeys';

  config = {
    apiTokenKey: 'DEEPSEEK_API_KEY',
  };

  /*
   * deepseek-chat / deepseek-reasoner / deepseek-coder were retired by DeepSeek on 2026-07-24.
   * V4 Pro is the default for app generation; V4 Flash is the cheaper, faster option.
   */
  staticModels: ModelInfo[] = [
    { name: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'Deepseek', maxTokenAllowed: 8192 },
    { name: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'Deepseek', maxTokenAllowed: 8192 },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'DEEPSEEK_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider. Get one at: ${this.getApiKeyLink}`);
    }

    return getOpenAILikeModel(DEFAULT_BASE_URL, apiKey, model, { fetch: disableThinkingFetch });
  }
}
