/*
 * provider-metadata.ts duplicates a few facts from the LLM registry so the browser can read them
 * without importing the registry itself (which costs ~600 KB of @ai-sdk packages in the client
 * bundle). Duplication is only safe if it cannot drift, so this test holds the copy against the
 * real thing — adding, removing or renaming a provider fails here instead of quietly breaking the
 * settings UI months later.
 *
 * This file runs in Node, so it may import the server registry freely.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER, PROVIDER_LIST, providerBaseUrlEnvKeys as serverEnvKeys } from './constants.server';
import {
  DEFAULT_PROVIDER_NAME,
  PROVIDER_NAMES,
  providerBaseUrlEnvKeys as clientEnvKeys,
  providerStub,
} from './provider-metadata';

describe('provider-metadata mirrors the registry', () => {
  it('lists exactly the registered providers', () => {
    expect([...PROVIDER_NAMES].sort()).toEqual(PROVIDER_LIST.map(p => p.name).sort());
  });

  it('names the same default provider the server resolves', () => {
    expect(DEFAULT_PROVIDER_NAME).toBe(DEFAULT_PROVIDER.name);
  });

  it('carries the same base-url and api-token env keys', () => {
    /* Compare normalised, so an explicit `undefined` and an absent key count as equal. */
    const normalise = (m: Record<string, { baseUrlKey?: string; apiTokenKey?: string }>) =>
      Object.fromEntries(
        Object.entries(m).map(([name, keys]) => [
          name,
          { baseUrlKey: keys.baseUrlKey ?? null, apiTokenKey: keys.apiTokenKey ?? null },
        ])
      );

    expect(normalise(clientEnvKeys)).toEqual(normalise(serverEnvKeys));
  });
});

describe('providerStub', () => {
  it('is enough for the client: a name, and models that arrive later from /api/models', () => {
    const stub = providerStub('Anthropic');

    expect(stub.name).toBe('Anthropic');
    expect(stub.staticModels).toEqual([]);
  });
});
