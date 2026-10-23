import { webcontainer } from '~/lib/webcontainer';
import { workbenchStore } from '~/lib/stores/workbench';
import { buildAndCollectDeployFiles } from '~/lib/deploy-build';

/**
 * "Make deployable" — one-click conversion of an older, server-rendered project into a static build
 * that Prompify can publish. Temporary helper: set to false to hide the menu option again.
 *
 * Why it exists: before the template allowlist (deployment plan step 1.2) a free-form prompt could
 * start a project from Remix, React Router or Astro. Those build to client/ + server/ with no
 * index.html, so the deploy refuses them. Asking the AI to convert them proved unreliable (it
 * reported changes it had not made), so the known config change is applied here directly, the
 * build is run, and only what the build still rejects is handed to the AI with the real error.
 */
export const MAKE_DEPLOYABLE_ENABLED = true;

type Framework = 'remix' | 'react-router' | 'astro' | 'vite' | 'unknown';

export type MakeDeployableResult = {
  ok: boolean;
  framework: Framework;

  /** Human-readable list of the edits that were applied. */
  changes: string[];

  /** Why it did not succeed (only when ok is false). */
  reason?: string;
};

const FRAMEWORK_LABEL: Record<Framework, string> = {
  remix: 'Remix',
  'react-router': 'React Router',
  astro: 'Astro',
  vite: 'Vite',
  unknown: 'this framework',
};

async function readText(path: string): Promise<string | null> {
  try {
    const container = await webcontainer;
    return await container.fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function writeText(path: string, content: string): Promise<void> {
  const container = await webcontainer;
  await container.fs.writeFile(path, content);
}

async function firstExisting(paths: string[]): Promise<{ path: string; content: string } | null> {
  for (const path of paths) {
    const content = await readText(path);

    if (content !== null) {
      return { path, content };
    }
  }

  return null;
}

function detectFramework(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps['@remix-run/dev']) {
    return 'remix';
  }

  if (deps['@react-router/dev']) {
    return 'react-router';
  }

  if (deps.astro) {
    return 'astro';
  }

  if (deps.vite) {
    return 'vite';
  }

  return 'unknown';
}

/** Remix (Vite plugin): `remix({ ssr: false, ... })` in vite.config. */
async function convertRemix(changes: string[]): Promise<string | null> {
  const config = await firstExisting(['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']);

  if (!config) {
    return 'no vite.config file found — this Remix app may use the old (non-Vite) compiler, which cannot be converted automatically';
  }

  if (/ssr\s*:\s*false/.test(config.content)) {
    return null;
  }

  let updated: string | null = null;

  if (/remix\(\s*\)/.test(config.content)) {
    updated = config.content.replace(/remix\(\s*\)/, 'remix({ ssr: false })');
  } else if (/remix\(\s*\{/.test(config.content)) {
    updated = config.content.replace(/remix\(\s*\{/, 'remix({\n      ssr: false,');
  }

  if (!updated) {
    return `could not find the remix() plugin call in ${config.path} — add "ssr: false" to it by hand`;
  }

  await writeText(config.path, updated);
  changes.push(`${config.path}: added ssr: false to the Remix plugin (SPA mode)`);

  return null;
}

/** React Router v7 framework mode: `ssr: false` in react-router.config. */
async function convertReactRouter(changes: string[]): Promise<string | null> {
  const config = await firstExisting(['react-router.config.ts', 'react-router.config.js']);

  if (!config) {
    await writeText(
      'react-router.config.ts',
      'import type { Config } from "@react-router/dev/config";\n\nexport default {\n  ssr: false,\n} satisfies Config;\n'
    );
    changes.push('react-router.config.ts: created with ssr: false (SPA mode)');

    return null;
  }

  if (/ssr\s*:\s*false/.test(config.content)) {
    return null;
  }

  let updated: string | null = null;

  if (/ssr\s*:\s*true/.test(config.content)) {
    updated = config.content.replace(/ssr\s*:\s*true/, 'ssr: false');
  } else if (/export\s+default\s*\{/.test(config.content)) {
    updated = config.content.replace(/export\s+default\s*\{/, 'export default {\n  ssr: false,');
  }

  if (!updated) {
    return `could not find where to set ssr: false in ${config.path} — set it by hand`;
  }

  await writeText(config.path, updated);
  changes.push(`${config.path}: set ssr: false (SPA mode)`);

  return null;
}

/** Astro: `output: 'static'` and no server adapter. */
async function convertAstro(changes: string[]): Promise<string | null> {
  const config = await firstExisting(['astro.config.mjs', 'astro.config.ts', 'astro.config.js']);

  if (!config) {
    return null; // no config means Astro's default, which is already static
  }

  let updated = config.content;

  if (/output\s*:\s*['"](server|hybrid)['"]/.test(updated)) {
    updated = updated.replace(/output\s*:\s*['"](server|hybrid)['"]/, "output: 'static'");
    changes.push(`${config.path}: output set to 'static'`);
  }

  // Only a single-line adapter setting is removed automatically; anything longer is left for a person.
  const singleLineAdapter = /^[ \t]*adapter\s*:\s*[^\n]*\)\s*,?[ \t]*\r?\n/m;

  if (singleLineAdapter.test(updated)) {
    updated = updated.replace(singleLineAdapter, '');
    changes.push(`${config.path}: removed the server adapter`);
  }

  if (/^[ \t]*adapter\s*:/m.test(updated)) {
    return `${config.path} still sets a server adapter over several lines — remove the "adapter: ..." setting by hand`;
  }

  if (updated !== config.content) {
    await writeText(config.path, updated);
  }

  return null;
}

function instructionsFor(framework: Framework): string {
  switch (framework) {
    case 'remix':
      return [
        'This Remix app was switched to SPA mode (ssr: false in vite.config) so Prompify can publish it as a static site. Keep ssr: false.',
        'Fix the build error below. In SPA mode no route may export loader, action or headers:',
        '- move data loading into clientLoader, or into useEffect using window.__PROMPIFY_CONFIG',
        '- replace a loader that only redirects with <Navigate to="..." replace /> from @remix-run/react',
        '- export HydrateFallback only from app/root.tsx',
        'Then run npm run build and confirm build/client/index.html exists.',
      ].join('\n');
    case 'react-router':
      return [
        'This React Router app was switched to SPA mode (ssr: false in react-router.config) so Prompify can publish it as a static site. Keep ssr: false.',
        'Fix the build error below: routes may not export loader or action in SPA mode — use clientLoader / clientAction, and redirect with <Navigate> from react-router.',
        'Then run npm run build and confirm build/client/index.html exists.',
      ].join('\n');
    case 'astro':
      return [
        "This Astro app was switched to output: 'static' with no server adapter so Prompify can publish it as a static site. Keep it static.",
        'Fix the build error below: remove or convert pages and endpoints that need a server (for example export const prerender = false, or server-only API routes).',
        'Then run npm run build and confirm dist/index.html exists.',
      ].join('\n');
    default:
      return 'Fix the build error below so that npm run build produces an index.html at the root of the build folder.';
  }
}

/** Show a failed conversion in the chat, with the real build log, so "Ask Prompify" can finish it. */
function raiseAlert(framework: Framework, reason: string, changes: string[]) {
  const current = workbenchStore.alert.get();

  // The runner already queued a generic "Build Failed" alert for the same build; this one replaces it.
  if (current?.title === 'Build Failed') {
    workbenchStore.clearAlert();
  }

  const buildLog = workbenchStore.firstArtifact?.runner.buildError?.output;

  workbenchStore.enqueueAlert({
    type: 'error',
    title: 'Make deployable: build failed',
    description: reason,
    content: [
      instructionsFor(framework),
      '',
      changes.length ? `Already changed automatically:\n${changes.map(c => `- ${c}`).join('\n')}` : '',
      '',
      buildLog ? `Build log:\n${buildLog.slice(-4000)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    source: 'terminal',
  });
}

export async function makeDeployable(): Promise<MakeDeployableResult> {
  const changes: string[] = [];
  const pkgText = await readText('package.json');

  if (!pkgText) {
    return { ok: false, framework: 'unknown', changes, reason: 'this project has no package.json' };
  }

  let framework: Framework = 'unknown';

  try {
    framework = detectFramework(JSON.parse(pkgText));
  } catch {
    return { ok: false, framework, changes, reason: 'package.json is not valid JSON' };
  }

  if (framework === 'unknown') {
    return {
      ok: false,
      framework,
      changes,
      reason: 'this framework (for example Next.js) cannot be converted automatically — start a new project instead',
    };
  }

  const convert =
    framework === 'remix'
      ? convertRemix
      : framework === 'react-router'
        ? convertReactRouter
        : framework === 'astro'
          ? convertAstro
          : null;

  const convertError = convert ? await convert(changes) : null;

  if (convertError) {
    return { ok: false, framework, changes, reason: convertError };
  }

  try {
    const files = await buildAndCollectDeployFiles('make deployable build');

    if (!files['/index.html'] && !files['/client/index.html']) {
      const reason = 'the build finished but produced no index.html';
      raiseAlert(framework, reason, changes);

      return { ok: false, framework, changes, reason };
    }

    return { ok: true, framework, changes };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    raiseAlert(framework, reason, changes);

    return { ok: false, framework, changes, reason };
  }
}

export function frameworkLabel(framework: Framework): string {
  return FRAMEWORK_LABEL[framework];
}
