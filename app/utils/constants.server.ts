/**
 * The live LLM provider registry. SERVER ONLY.
 *
 * These three exports used to sit in `app/utils/constants.ts`, which is imported by a dozen
 * client modules — most importantly `app/lib/stores/settings.ts`. Instantiating LLMManager at
 * module scope made `registry.ts` reachable from the browser entry, and `registry.ts` statically
 * imports all nineteen providers and their `@ai-sdk` packages. The result was roughly 600 KB
 * gzipped (about 2 MB unparsed) of provider SDKs downloaded, parsed and executed on the main
 * thread of every builder page load, to support code that never calls any of it: nothing in the
 * client ever invokes `getModelInstance`, which is the only method that needs those SDKs.
 *
 * The browser gets provider metadata from `/api/models` instead, which already serialises each
 * provider down to the plain fields the UI actually reads. Keep it that way: importing this
 * module from a `.client.tsx` file, or from anything a client component can reach, puts the whole
 * registry back in the bundle. `app/lib/.server/llm/` and route action/loader code are the only
 * legitimate callers.
 */
import { LLMManager } from '~/lib/modules/llm/manager';
import { DEFAULT_MODEL } from './constants';

const llmManager = LLMManager.getInstance(import.meta.env);

export const PROVIDER_LIST = llmManager.getAllProviders();

/** Prefer the provider that actually defines DEFAULT_MODEL so first load matches Qwen + team key workflows. */
export const DEFAULT_PROVIDER =
  PROVIDER_LIST.find(p => (p.staticModels ?? []).some(m => m.name === DEFAULT_MODEL)) ??
  llmManager.getDefaultProvider();

export const providerBaseUrlEnvKeys: Record<string, { baseUrlKey?: string; apiTokenKey?: string }> = {};
PROVIDER_LIST.forEach(provider => {
  providerBaseUrlEnvKeys[provider.name] = {
    baseUrlKey: provider.config.baseUrlKey,
    apiTokenKey: provider.config.apiTokenKey,
  };
});
