import type { WebContainer } from '@webcontainer/api';
import { path as nodePath } from '~/utils/path';
import { atom, map, type MapStore } from 'nanostores';
import type { ActionAlert, BoltAction, FileHistory } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';
import type { BoltShell } from '~/utils/shell';
import type { PreviewsStore } from '~/lib/stores/previews';
import { chatId } from '~/lib/persistence';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

class ActionCommandError extends Error {
  readonly _output: string;
  readonly _header: string;

  constructor(message: string, output: string) {
    // Create a formatted message that includes both the error message and output
    const formattedMessage = `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}`;
    super(formattedMessage);

    // Set the output separately so it can be accessed programmatically
    this._header = message;
    this._output = output;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ActionCommandError.prototype);

    // Set the name of the error for better debugging
    this.name = 'ActionCommandError';
  }

  // Optional: Add a method to get just the terminal output
  get output() {
    return this._output;
  }
  get header() {
    return this._header;
  }
}

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #shellTerminal: () => BoltShell;
  #previewsStore?: PreviewsStore;
  #hadStartAction = false;
  #hadProductiveAction = false;
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});
  onAlert?: (alert: ActionAlert) => void;
  buildOutput?: { path: string; exitCode: number; output: string };

  constructor(
    webcontainerPromise: Promise<WebContainer>,
    getShellTerminal: () => BoltShell,
    onAlert?: (alert: ActionAlert) => void,
    previewsStore?: PreviewsStore
  ) {
    this.#webcontainer = webcontainerPromise;
    this.#shellTerminal = getShellTerminal;
    this.onAlert = onAlert;
    this.#previewsStore = previewsStore;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return; // No return value here
    }

    if (isStreaming && action.type !== 'file') {
      return; // No return value here
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: !isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, isStreaming);
      })
      .catch(error => {
        console.error('Action failed:', error);
      });

    await this.#currentExecutionPromise;

    return;
  }

  async #executeAction(actionId: string, isStreaming: boolean = false) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          this.#hadProductiveAction = true;
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          this.#hadProductiveAction = true;
          await this.#runFileAction(action);
          break;
        }
        case 'build': {
          this.#hadProductiveAction = true;

          const buildOutput = await this.#runBuildAction(action);

          // Store build output for deployment
          this.buildOutput = buildOutput;
          break;
        }
        case 'start': {
          this.#hadStartAction = true;
          this.#hadProductiveAction = true;

          // making the start app non blocking

          this.#runStartAction(action)
            .then(() => this.#updateAction(actionId, { status: 'complete' }))
            .catch((err: Error) => {
              if (action.abortSignal.aborted) {
                return;
              }

              this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
              logger.error(`[${action.type}]:Action failed\n\n`, err);

              if (!(err instanceof ActionCommandError)) {
                return;
              }

              this.onAlert?.({
                type: 'error',
                title: 'Dev Server Failed',
                description: err.header,
                content: err.output,
              });
            });

          /*
           * adding a delay to avoid any race condition between 2 start actions
           * i am up for a better approach
           */
          await new Promise(resolve => setTimeout(resolve, 2000));

          return;
        }
        case 'data': {
          this.#hadProductiveAction = true;
          await this.#runDataAction(action);
          break;
        }
      }

      this.#updateAction(actionId, {
        status: isStreaming ? 'running' : action.abortSignal.aborted ? 'aborted' : 'complete',
      });
    } catch (error) {
      if (action.abortSignal.aborted) {
        return;
      }

      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
      logger.error(`[${action.type}]:Action failed\n\n`, error);

      if (!(error instanceof ActionCommandError)) {
        return;
      }

      this.onAlert?.({
        type: 'error',
        title: 'Dev Server Failed',
        description: error.header,
        content: error.output,
      });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  /*
   * Data action — provisions Postgres tables + seeds sample rows via the
   * Prompify data proxy. Runs from the Prompify browser tab (session cookie
   * auth), NOT from the WebContainer. The AI emits a JSON body with tables[]
   * (each: tableName, columns[], sampleRows[]). For each table:
   *   1. POST /api/data/:chatId/schema  — creates the table (idempotent).
   *   2. POST /api/data/:chatId/:table/seed — bulk-inserts sample rows.
   *
   * Must run BEFORE type="start" so tables exist when the dev server boots.
   * Idempotent: schema POST uses ON CONFLICT DO NOTHING; seed is a no-op if
   * the table already has rows (the AI checks row_count in the ## App Database
   * section on subsequent turns).
   */
  async #runDataAction(action: ActionState) {
    if (action.type !== 'data') {
      unreachable('Expected data action');
    }

    const id = chatId.get();

    if (!id) {
      logger.warn('data action: chatId not set — skipping table provisioning');

      return;
    }

    let payload: { tables?: Array<{ tableName: string; columns?: unknown[]; sampleRows?: Record<string, unknown>[] }> };

    try {
      payload = JSON.parse(action.content);
    } catch {
      logger.error('data action: invalid JSON body');

      return;
    }

    const tables = Array.isArray(payload.tables) ? payload.tables : [];

    if (tables.length === 0) {
      logger.warn('data action: no tables in payload');

      return;
    }

    for (const table of tables) {
      if (!table.tableName || !Array.isArray(table.columns) || table.columns.length === 0) {
        logger.warn(`data action: skipping invalid table definition for "${table.tableName}"`);

        continue;
      }

      /*
       * 1. Create the table (idempotent — ON CONFLICT DO NOTHING on the
       *    registry). The schema endpoint takes { tableName, columns: [{name,
       *    type, nullable, defaultValue?}] }.
       */
      try {
        const schemaRes = await fetch(`/api/data/${encodeURIComponent(id)}/schema`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableName: table.tableName, columns: table.columns }),
        });

        if (!schemaRes.ok) {
          const err = await schemaRes.text();
          logger.warn(`data action: schema creation for "${table.tableName}" failed (${schemaRes.status}): ${err}`);

          continue;
        }

        logger.info(`data action: created table "${table.tableName}"`);
      } catch (err) {
        logger.error(`data action: schema fetch failed for "${table.tableName}":`, err);

        continue;
      }

      /*
       * 2. Seed sample rows (if any). The seed endpoint accepts {rows: [...]}
       *    and bulk-inserts in one transaction.
       */
      const sampleRows = Array.isArray(table.sampleRows) ? table.sampleRows : [];

      if (sampleRows.length === 0) {
        continue;
      }

      try {
        const seedRes = await fetch(`/api/data/${encodeURIComponent(id)}/${encodeURIComponent(table.tableName)}/seed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: sampleRows }),
        });

        if (!seedRes.ok) {
          const err = await seedRes.text();
          logger.warn(`data action: seed for "${table.tableName}" failed (${seedRes.status}): ${err}`);

          continue;
        }

        const result = (await seedRes.json()) as { inserted?: number };
        logger.info(`data action: seeded ${result.inserted ?? 0} rows into "${table.tableName}"`);
      } catch (err) {
        logger.error(`data action: seed fetch failed for "${table.tableName}":`, err);
      }
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const shell = this.#shellTerminal();
    await shell.ready();

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      throw new ActionCommandError(`Failed To Execute Shell Command`, resp?.output || 'No Output Available');
    }
  }

  async #runStartAction(action: ActionState) {
    if (action.type !== 'start') {
      unreachable('Expected shell action');
    }

    if (!this.#shellTerminal) {
      unreachable('Shell terminal not found');
    }

    const shell = this.#shellTerminal();
    await shell.ready();

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    /*
     * Safety net: if node_modules is missing, auto-install before starting.
     * This catches cases where the AI forgot to include an `npm install` shell action.
     * Uses `npm ci` when package-lock.json exists (faster, uses lock file directly).
     */
    const webcontainer = await this.#webcontainer;

    let needsInstall = false;

    try {
      await webcontainer.fs.readdir('node_modules');
    } catch {
      needsInstall = true;
    }

    if (needsInstall) {
      let hasLockFile = false;

      try {
        await webcontainer.fs.readFile('package-lock.json');
        hasLockFile = true;
      } catch {
        try {
          await webcontainer.fs.readFile('pnpm-lock.yaml');
          hasLockFile = true;
        } catch {
          // no lock file — fall back to npm install
        }
      }

      const installCmd = hasLockFile ? 'npm ci' : 'npm install';

      logger.debug(`[start] node_modules missing — auto-running ${installCmd}`);

      const installResp = await shell.executeCommand(this.runnerId.get(), installCmd, () => {
        logger.debug('[start] Aborting auto-install');
      });

      if (installResp?.exitCode !== 0) {
        throw new ActionCommandError(
          'Dependency installation failed (auto-install before start)',
          installResp?.output || 'No output available'
        );
      }
    }

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      throw new ActionCommandError('Failed To Start Application', resp?.output || 'No Output Available');
    }

    return resp;
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;
    const relativePath = nodePath.relative(webcontainer.workdir, action.filePath);

    let folder = nodePath.dirname(relativePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await webcontainer.fs.writeFile(relativePath, action.content);
      logger.debug(`File written ${relativePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    try {
      const webcontainer = await this.#webcontainer;
      const historyPath = this.#getHistoryPath(filePath);
      const content = await webcontainer.fs.readFile(historyPath, 'utf-8');

      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to get file history:', error);
      return null;
    }
  }

  async saveFileHistory(filePath: string, history: FileHistory) {
    // const webcontainer = await this.#webcontainer;
    const historyPath = this.#getHistoryPath(filePath);

    await this.#runFileAction({
      type: 'file',
      filePath: historyPath,
      content: JSON.stringify(history),
      changeSource: 'auto-save',
    } as any);
  }

  #getHistoryPath(filePath: string) {
    return nodePath.join('.history', filePath);
  }

  async #runBuildAction(action: ActionState) {
    if (action.type !== 'build') {
      unreachable('Expected build action');
    }

    const webcontainer = await this.#webcontainer;

    console.log('[ActionRunner] Starting build process...');
    console.log('[ActionRunner] WebContainer workdir:', webcontainer.workdir);

    // Create a new terminal specifically for the build
    const buildProcess = await webcontainer.spawn('npm', ['run', 'build']);

    let output = '';
    buildProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          output += data;
        },
      })
    );

    const exitCode = await buildProcess.exit;

    if (exitCode !== 0) {
      console.error('[ActionRunner] Build failed with exit code:', exitCode);
      console.error('[ActionRunner] Build output:', output);
      throw new ActionCommandError('Build Failed', output || 'No Output Available');
    }

    console.log('[ActionRunner] Build completed successfully');
    console.log('[ActionRunner] Build output:', output);

    // Get the build output directory path
    const buildDir = nodePath.join(webcontainer.workdir, 'dist');

    console.log('[ActionRunner] Expected build directory:', buildDir);
    console.log('[ActionRunner] WebContainer workdir type:', typeof webcontainer.workdir);
    console.log('[ActionRunner] WebContainer workdir length:', webcontainer.workdir.length);
    console.log('[ActionRunner] Is workdir absolute?', nodePath.isAbsolute(webcontainer.workdir));
    console.log('[ActionRunner] Workdir starts with /home?', webcontainer.workdir.startsWith('/home'));

    // Try to list the root directory to see what's available
    try {
      const rootContents = await webcontainer.fs.readdir('/', { withFileTypes: true });
      console.log(
        '[ActionRunner] Root directory contents:',
        rootContents.map(entry => entry.name)
      );
    } catch (error) {
      console.log('[ActionRunner] Cannot access root directory:', error);
    }

    // Try to list the workdir to see what's available
    try {
      const workdirContents = await webcontainer.fs.readdir('.', { withFileTypes: true });
      console.log(
        '[ActionRunner] Workdir contents (using .):',
        workdirContents.map(entry => entry.name)
      );
    } catch (error) {
      console.log('[ActionRunner] Cannot access workdir using .:', error);
    }

    /*
     * The key insight: webcontainer.fs methods expect RELATIVE paths, not absolute paths
     * So we need to use 'dist' instead of '/home/project-m9jw7fwv2t/dist'
     */
    const relativeBuildDir = 'dist';
    console.log('[ActionRunner] Using relative build directory:', relativeBuildDir);

    // Try to access the dist directory using relative path
    try {
      const buildDirContents = await webcontainer.fs.readdir(relativeBuildDir, { withFileTypes: true });
      console.log(
        '[ActionRunner] Build directory contents (using relative path):',
        buildDirContents.map(entry => entry.name)
      );

      // Success! Return the full path for the caller
      return {
        path: buildDir, // Return the full path for external use
        exitCode,
        output,
      };
    } catch (error) {
      console.log('[ActionRunner] Cannot access dist using relative path:', error);
    }

    // If the expected dist directory doesn't exist, try alternative build directories
    console.log('[ActionRunner] Expected build directory not accessible, trying alternatives...');

    const possibleBuildDirs = ['build', 'dist', 'out', '.output'];

    for (const dir of possibleBuildDirs) {
      try {
        console.log(`[ActionRunner] Trying alternative directory: ${dir}`);

        const altContents = await webcontainer.fs.readdir(dir, { withFileTypes: true });
        console.log(`[ActionRunner] Found alternative build directory: ${dir}`);
        console.log(
          `[ActionRunner] Contents:`,
          altContents.map(entry => entry.name)
        );

        // Use the first alternative directory that exists and has content
        if (altContents.length > 0) {
          const altBuildDir = nodePath.join(webcontainer.workdir, dir);
          console.log(`[ActionRunner] Using alternative build directory: ${altBuildDir}`);

          return {
            path: altBuildDir,
            exitCode,
            output,
          };
        }
      } catch (altError) {
        console.log(`[ActionRunner] Cannot access ${dir}:`, altError);
        // Continue checking other directories
      }
    }

    // If no alternative directories found, throw error
    throw new ActionCommandError(
      'Build Failed - No build output directory found',
      `Expected build directory ${buildDir} not found. Build output: ${output}`
    );
  }

  async maybeAutoStartDevServer() {
    if (this.#hadStartAction || !this.#hadProductiveAction || !this.#previewsStore) {
      return;
    }

    const runningPreviews = this.#previewsStore.previews.get();

    if (runningPreviews.length > 0) {
      return;
    }

    try {
      logger.info('Auto-injecting npm run dev (preview down, no start action in artifact)');

      const shell = this.#shellTerminal();
      await shell.ready();

      if (!shell || !shell.terminal || !shell.process) {
        return;
      }

      const resp = await shell.executeCommand(this.runnerId.get(), 'npm run dev', () => {
        logger.debug('[auto-start] Aborted');
      });

      if (resp?.exitCode !== 0) {
        logger.warn(`[auto-start] npm run dev exited with code ${resp?.exitCode}`);
      }
    } catch (error) {
      logger.warn('Auto-start dev server failed:', error);
    }
  }
}
