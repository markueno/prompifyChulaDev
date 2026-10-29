/**
 * Fail if the LLM provider registry has crept back into the client bundle.
 *
 * `app/utils/constants.ts` once instantiated LLMManager at module scope. Because a dozen client
 * modules import that file, the whole registry — nineteen providers and their `@ai-sdk`
 * packages — was downloaded, parsed and executed in every visitor's browser, to support code
 * that never called any of it. The fix (constants.server.ts + provider-metadata.ts) is easy to
 * undo by accident: one `import { PROVIDER_LIST } from '~/utils/constants.server'` in a client
 * component puts it all back, silently, and nobody notices for months.
 *
 * So this asserts the absence directly, against the built output rather than the source, which
 * is the only place the question can actually be settled.
 *
 * Usage:  pnpm build && node scripts/check-client-bundle.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = 'build/client/assets';

/*
 * Markers unique to the provider SDKs and the registry plumbing. Deliberately NOT plain provider
 * names like "anthropic" or env keys like OPEN_ROUTER_API_KEY: those legitimately appear in
 * provider-metadata.ts and in the settings UI, and matching them would make this check cry wolf.
 */
const FORBIDDEN = [
  '@ai-sdk',
  'createAnthropic',
  'createOpenAI',
  'createMistral',
  'createCohere',
  'createGoogleGenerativeAI',
  'getModelInstance',
  'registerProvider',
  'cachedDynamicModels',
];

let files;

try {
  files = readdirSync(ASSETS_DIR).filter(f => f.endsWith('.js'));
} catch {
  console.error(`✗ ${ASSETS_DIR} not found — run \`pnpm build\` first.`);
  process.exit(2);
}

if (files.length === 0) {
  console.error(`✗ No JS chunks in ${ASSETS_DIR} — the build looks incomplete.`);
  process.exit(2);
}

const offences = [];

for (const file of files) {
  const path = join(ASSETS_DIR, file);
  const source = readFileSync(path, 'utf8');

  for (const marker of FORBIDDEN) {
    if (source.includes(marker)) {
      offences.push({ file, marker, kb: Math.round(statSync(path).size / 1024) });
    }
  }
}

if (offences.length > 0) {
  console.error('✗ The LLM provider registry is in the client bundle again.\n');

  for (const o of offences) {
    console.error(`    ${o.file} (${o.kb} KB)  contains  "${o.marker}"`);
  }

  console.error(
    '\n  Something client-reachable imports the registry. Provider metadata belongs in\n' +
      '  app/utils/provider-metadata.ts (static) or /api/models (fetched); the live registry\n' +
      '  in app/utils/constants.server.ts is server-only.\n'
  );
  process.exit(1);
}

console.log(`✓ Client bundle is free of the LLM provider registry (${files.length} chunks checked).`);
