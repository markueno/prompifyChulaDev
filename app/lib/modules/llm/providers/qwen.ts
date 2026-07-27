import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

/** Alibaba Cloud Qwen - OpenAI compatible API */
const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

/*
 * DashScope qwen3 models default to "thinking" ON. While reasoning, the gateway streams
 * only `reasoning_content` deltas, which @ai-sdk/openai@1.1.9 DROPS — so the UI shows
 * "Generating Response" for the whole (possibly multi-minute) reasoning phase with no
 * visible output (CONTEXT-HANDOFF-2026-07-10-EOD §4.4). Disable thinking by injecting
 * `enable_thinking: false` into the request body AFTER the SDK has serialized it, so the
 * SDK cannot strip the non-standard field. Unknown params are ignored by gateways that
 * don't support it, so this is a safe no-op there.
 */
const disableThinkingFetch: typeof globalThis.fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const payload = JSON.parse(init.body);

      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        payload.enable_thinking = false;
        init = { ...init, body: JSON.stringify(payload) };
      }
    } catch {
      // Body isn't JSON we can parse — forward it untouched.
    }
  }

  const r = await globalThis.fetch(input, init);

  // If no body (HEAD, 204, etc.), nothing to re-wrap — forward as-is.
  if (!r.body) {
    return r;
  }

  /*
   * Re-wrap the response body through globalThis.ReadableStream so the AI SDK's
   * pipeThrough(new TextDecoderStream()) operates on the same-realm ReadableStream.
   * Without this, undici's ReadableStream fails instanceof checks inside the SDK
   * when the Vite bundle creates TextDecoderStream from a different realm.
   */
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

export default class QwenProvider extends BaseProvider {
  name = 'Qwen';
  getApiKeyLink = 'https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key';

  config = {
    baseUrlKey: 'DASHSCOPE_API_BASE_URL',
    apiTokenKey: 'DASHSCOPE_API_KEY',
  };

  staticModels: ModelInfo[] = [
    { name: 'qwen3.7-max', label: 'Qwen3.7-Max', provider: 'Qwen', maxTokenAllowed: 8192 },
    { name: 'qwen3.7-plus', label: 'Qwen3.7-Plus', provider: 'Qwen', maxTokenAllowed: 8192 },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'DASHSCOPE_API_BASE_URL',
      defaultApiTokenKey: 'DASHSCOPE_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider. Get one at: ${this.getApiKeyLink}`);
    }

    const effectiveBaseUrl = baseUrl || DEFAULT_BASE_URL;

    return getOpenAILikeModel(effectiveBaseUrl, apiKey, model, { fetch: disableThinkingFetch });
  }
}
