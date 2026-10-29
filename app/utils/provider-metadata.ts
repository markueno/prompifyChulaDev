/**
 * Provider facts the browser needs synchronously. Client-safe by construction.
 *
 * The rich metadata — model lists, icons, API-key links — comes from `/api/models`, which the
 * chat UI already fetches and which serialises each provider down to plain JSON. But a few places
 * need a provider name *before* any fetch can resolve: the settings store builds its defaults at
 * module scope, and Chat.client picks an initial provider during `useState` initialisation.
 * Importing the real registry to answer those questions is what put ~600 KB of `@ai-sdk` packages
 * in the client bundle (see constants.server.ts).
 *
 * So the handful of static facts live here instead, as plain data with no imports that carry
 * runtime code. `provider-metadata.spec.ts` asserts this file still matches the real registry, so
 * adding or renaming a provider fails the test rather than silently drifting.
 */
import type { ProviderInfo } from '~/types/model';

/** Every registered provider, in registry order. Generated from PROVIDER_LIST — keep in sync. */
export const PROVIDER_NAMES = [
  'Anthropic',
  'Cohere',
  'Deepseek',
  'Github',
  'Google',
  'Groq',
  'HuggingFace',
  'Hyperbolic',
  'LMStudio',
  'Mistral',
  'Ollama',
  'OpenAILike',
  'OpenAI',
  'OpenRouter',
  'Perplexity',
  'Qwen',
  'Together',
  'xAI',
] as const;

/**
 * Matches DEFAULT_PROVIDER on the server, which resolves to whichever provider defines
 * DEFAULT_MODEL (`qwen3.7-max`).
 */
export const DEFAULT_PROVIDER_NAME = 'Qwen';

/** Env var names per provider, for the settings tabs' "where does this key come from" hints. */
export const providerBaseUrlEnvKeys: Record<string, { baseUrlKey?: string; apiTokenKey?: string }> = {
  Anthropic: { apiTokenKey: 'ANTHROPIC_API_KEY' },
  Cohere: { apiTokenKey: 'COHERE_API_KEY' },
  Deepseek: { apiTokenKey: 'DEEPSEEK_API_KEY' },
  Github: { apiTokenKey: 'GITHUB_API_KEY' },
  Google: { apiTokenKey: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  Groq: { apiTokenKey: 'GROQ_API_KEY' },
  HuggingFace: { apiTokenKey: 'HuggingFace_API_KEY' },
  Hyperbolic: { apiTokenKey: 'HYPERBOLIC_API_KEY' },
  LMStudio: { baseUrlKey: 'LMSTUDIO_API_BASE_URL' },
  Mistral: { apiTokenKey: 'MISTRAL_API_KEY' },
  Ollama: { baseUrlKey: 'OLLAMA_API_BASE_URL' },
  OpenAILike: { baseUrlKey: 'OPENAI_LIKE_API_BASE_URL', apiTokenKey: 'OPENAI_LIKE_API_KEY' },
  OpenAI: { apiTokenKey: 'OPENAI_API_KEY' },
  OpenRouter: { apiTokenKey: 'OPEN_ROUTER_API_KEY' },
  Perplexity: { apiTokenKey: 'PERPLEXITY_API_KEY' },
  Qwen: { baseUrlKey: 'DASHSCOPE_API_BASE_URL', apiTokenKey: 'DASHSCOPE_API_KEY' },
  Together: { baseUrlKey: 'TOGETHER_API_BASE_URL', apiTokenKey: 'TOGETHER_API_KEY' },
  xAI: { apiTokenKey: 'XAI_API_KEY' },
};

/**
 * A name-only stand-in for a provider.
 *
 * No cast needed: `~/types/model`'s ProviderInfo is the client-facing shape and has no
 * `getModelInstance` — that method lives only on the server-side registry type, and nothing in
 * the browser calls it, since the request carries `provider.name` and the server resolves the
 * real provider from that. `staticModels` and the display fields fill in from `/api/models`.
 *
 * The call sites this replaced were all casting `PROVIDER_LIST.find(...) as ProviderInfo`, so
 * this is the same value they were constructing, minus the bundle cost of the registry.
 */
export function providerStub(name: string): ProviderInfo {
  return { name, staticModels: [] };
}
