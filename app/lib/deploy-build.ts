import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { path } from '~/utils/path';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';

/**
 * Build the project and collect the BUILD OUTPUT as a deployable file map.
 *
 * This exists because the two deploy entry points used to do different things. The Deploy button
 * ran `npm run build` and shipped the build directory; "Share preview" shipped
 * `workbenchStore.files.get()` — the raw source tree. That meant a shared app was served unbuilt,
 * so an index.html referencing /src/main.tsx never ran, and the user's full source (including
 * anything sensitive sitting in the project) was published alongside it.
 *
 * One copy now, so the two can't drift apart again.
 *
 * Paths are returned relative to the build directory with a leading slash ('/index.html'), which
 * is the shape `/api/deploy` expects.
 */
export async function buildAndCollectDeployFiles(messageId = 'deploy build'): Promise<Record<string, string>> {
  const artifact = workbenchStore.firstArtifact;

  if (!artifact) {
    throw new Error('No active project found');
  }

  const actionId = 'build-' + Date.now();
  const actionData: ActionCallbackData = {
    messageId,
    artifactId: artifact.id,
    actionId,
    action: {
      type: 'build' as const,
      content: 'npm run build',
    },
  };

  // Register the action before running it — the runner resolves it by id.
  artifact.runner.addAction(actionData);
  await artifact.runner.runAction(actionData);

  if (!artifact.runner.buildOutput) {
    throw new Error('Build failed');
  }

  const container = await webcontainer;
  const buildPath = artifact.runner.buildOutput.path;

  // The WebContainer fs API wants paths relative to the workdir, not the absolute ones.
  const toRelative = (p: string) => p.replace(container.workdir, '').replace(/^\/+/, '') || '.';

  try {
    await container.fs.readdir(toRelative(buildPath), { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Build directory not found: ${buildPath}. Error: ${message}`);
  }

  async function collect(dirPath: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const relativeDirPath = toRelative(dirPath);

    try {
      const entries = await container.fs.readdir(relativeDirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isFile()) {
          try {
            const content = await container.fs.readFile(path.join(relativeDirPath, entry.name), 'utf-8');

            // Strip the build-dir prefix so the key is the path the site will serve it at.
            let deployPath = fullPath.replace(buildPath, '');

            if (!deployPath.startsWith('/')) {
              deployPath = '/' + deployPath;
            }

            files[deployPath] = content;
          } catch (error) {
            // One unreadable file shouldn't sink the whole deploy.
            console.error('[Deploy] Failed to read file:', fullPath, error);
          }
        } else if (entry.isDirectory()) {
          Object.assign(files, await collect(fullPath));
        }
      }
    } catch (error) {
      console.error('[Deploy] Failed to read directory:', dirPath, error);
    }

    return files;
  }

  const files = await collect(buildPath);

  if (Object.keys(files).length === 0) {
    throw new Error(`Build produced no files in ${buildPath}`);
  }

  return files;
}
