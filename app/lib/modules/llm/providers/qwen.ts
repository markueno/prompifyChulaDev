import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

/** Alibaba Cloud Qwen - OpenAI compatible API */
const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export default class QwenProvider extends BaseProvider {
  name = 'Qwen';
  getApiKeyLink = 'https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key';

  config = {
    baseUrlKey: 'DASHSCOPE_API_BASE_URL',
    apiTokenKey: 'DASHSCOPE_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /** Team / DashScope compatible-mode id (long API keys OK; Alibaba Model Studio naming). */
    { name: 'qwen3.6-plus', label: 'Qwen3.6-Plus', provider: 'Qwen', maxTokenAllowed: 65536 },
    { name: 'qwen-max', label: 'Qwen-Max', provider: 'Qwen', maxTokenAllowed: 32000 },
    { name: 'qwen-plus', label: 'Qwen-Plus', provider: 'Qwen', maxTokenAllowed: 32000 },
    { name: 'qwen-turbo', label: 'Qwen-Turbo', provider: 'Qwen', maxTokenAllowed: 32000 },
    { name: 'qwen3.5-plus', label: 'Qwen3.5-Plus', provider: 'Qwen', maxTokenAllowed: 32000 },
    { name: 'qwen3.5-flash', label: 'Qwen3.5-Flash', provider: 'Qwen', maxTokenAllowed: 32000 },
    { name: 'qwen3-max', label: 'Qwen3-Max', provider: 'Qwen', maxTokenAllowed: 32000 },
    { name: 'qwen3-coder-next', label: 'Qwen3-Coder-Next', provider: 'Qwen', maxTokenAllowed: 32000 },
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

    return getOpenAILikeModel(effectiveBaseUrl, apiKey, model);
  }
}
