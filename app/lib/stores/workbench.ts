import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { AdminSectionId } from '~/components/workbench/AdminPanel';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { webcontainer } from '~/lib/webcontainer';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';
import JSZip from 'jszip';
import fileSaver from 'file-saver';
import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import { path } from '~/utils/path';
import { extractRelativePath } from '~/utils/diff';
import Cookies from 'js-cookie';
import { createSampler } from '~/utils/sampler';
import { snapshotPathToRelative } from '~/lib/snapshots/loadSnapshot';
import { scheduleSnapshotSave } from '~/lib/persistence/useChatHistory';
import type { ActionAlert } from '~/types/actions';
import { addError, parseFileAndLine } from '~/lib/stores/errors';

const { saveAs } = fileSaver;

export interface ArtifactState {
  id: string;
  title: string;
  type?: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'admin' | 'code' | 'diff' | 'preview' | 'problems';

export class WorkbenchStore {
  #previewsStore = new PreviewsStore(webcontainer);
  #filesStore = new FilesStore(webcontainer);
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(webcontainer);
  #alertQueue: ActionAlert[] = [...(import.meta.hot?.data.alertQueue ?? [])];

  #reloadedMessages = new Set<string>();

  /**
   * Day 9b — set true when the current chat's files were restored from a codebase snapshot.
   * While set, historical FILE-action replay (from reloaded/historical messages) is skipped in
   * `_runAction` so the instant snapshot mount isn't overwritten by slow per-file re-writes.
   * Shell/start actions still replay (the dev server boots with the project's own command), and
   * new generations are unaffected because their messageIds are never in `#reloadedMessages`.
   */
  #restoredFromSnapshot = false;

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  /** Active section in Admin panel (users, logs, …). Shared so code can deep-link to Logs. */
  adminPanelSection: WritableAtom<AdminSectionId> =
    import.meta.hot?.data.adminPanelSection ?? atom<AdminSectionId>('overview');
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  actionAlert: WritableAtom<ActionAlert | undefined> =
    import.meta.hot?.data.actionAlert ?? atom<ActionAlert | undefined>(undefined);
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #globalExecutionQueue = Promise.resolve();
  constructor() {
    if (!this.actionAlert.get() && this.#alertQueue.length > 0) {
      this.actionAlert.set(this.#alertQueue[0]);
    }

    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
      import.meta.hot.data.adminPanelSection = this.adminPanelSection;
      import.meta.hot.data.actionAlert = this.actionAlert;
      import.meta.hot.data.alertQueue = this.#alertQueue;
    }
  }

  addToExecutionQueue(callback: () => Promise<void>) {
    this.#globalExecutionQueue = this.#globalExecutionQueue.then(() => callback());
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }
  get boltTerminal() {
    return this.#terminalStore.boltTerminal;
  }
  get alert() {
    return this.actionAlert;
  }
  clearAlert() {
    if (this.#alertQueue.length > 0) {
      this.#alertQueue.shift();
    }

    this.actionAlert.set(this.#alertQueue[0]);

    if (import.meta.hot) {
      import.meta.hot.data.alertQueue = this.#alertQueue;
    }
  }

  enqueueAlert(alert: ActionAlert) {
    const lastQueued = this.#alertQueue[this.#alertQueue.length - 1];

    if (
      lastQueued &&
      lastQueued.source === alert.source &&
      lastQueued.description === alert.description &&
      lastQueued.content === alert.content
    ) {
      return;
    }

    this.#alertQueue.push(alert);

    if (!this.actionAlert.get()) {
      this.actionAlert.set(alert);
    }

    if (import.meta.hot) {
      import.meta.hot.data.alertQueue = this.#alertQueue;
    }

    // Mirror into the unified errors store so terminal errors appear in the Problems panel
    if (alert.type === 'error') {
      const source = alert.source === 'preview' ? 'runtime' : 'terminal';
      addError({
        source,
        level: 'error',
        message: alert.description || alert.title,
        stack: alert.content || undefined,
        ...parseFileAndLine(alert.content),
      });
    }
  }

  /** True while artifact action(s) are still pending/running. If messageId is provided, checks only that artifact. */
  hasArtifactWorkInProgress(messageId?: string): boolean {
    const hasRunningActions = (artifact: ArtifactState | undefined) => {
      if (!artifact) {
        return false;
      }

      for (const action of Object.values(artifact.runner.actions.get())) {
        if (action.status === 'pending' || action.status === 'running') {
          return true;
        }
      }

      return false;
    };

    if (messageId) {
      return hasRunningActions(this.artifacts.get()[messageId]);
    }

    for (const artifact of Object.values(this.artifacts.get())) {
      if (hasRunningActions(artifact)) {
        return true;
      }
    }

    return false;
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  attachTerminal(terminal: ITerminal) {
    this.#terminalStore.attachTerminal(terminal);
  }
  attachBoltTerminal(terminal: ITerminal) {
    this.#terminalStore.attachBoltTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      // we find the first file and select it
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath);
          break;
        }
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;

    if (!filePath) {
      return;
    }

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const currentDocument = this.currentDocument.get();

    if (currentDocument) {
      const previousUnsavedFiles = this.unsavedFiles.get();

      if (unsavedChanges && previousUnsavedFiles.has(currentDocument.filePath)) {
        return;
      }

      const newUnsavedFiles = new Set(previousUnsavedFiles);

      if (unsavedChanges) {
        newUnsavedFiles.add(currentDocument.filePath);
      } else {
        newUnsavedFiles.delete(currentDocument.filePath);
      }

      this.unsavedFiles.set(newUnsavedFiles);
    }
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    await this.#filesStore.saveFile(filePath, document.value);

    scheduleSnapshotSave();

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);

    if (!file) {
      return;
    }

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }
  getModifiedFiles() {
    return this.#filesStore.getModifiedFiles();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  abortAllActions() {
    // TODO: what do we wanna do and how do we wanna recover from this?
  }

  setReloadedMessages(messages: string[]) {
    this.#reloadedMessages = new Set(messages);
  }

  /**
   * Day 9b — mark (or clear) that the current chat was restored from a codebase snapshot.
   * Reset to false at the start of every chat load; set to true only after a successful mount.
   */
  setRestoredFromSnapshot(value: boolean) {
    this.#restoredFromSnapshot = value;
  }

  /**
   * Day 10 — reset the WebContainer and all workbench state for a new chat. Kills all running
   * terminal processes, wipes the workdir, and resets IDE/preview stores so the new chat starts
   * from a clean slate. Best-effort (worker-pool permission errors are swallowed).
   */
  async resetForNewChat() {
    this.#restoredFromSnapshot = false;
    this.#reloadedMessages = new Set();

    // Reset nanostore state — clears the IDE, preview, and file tree instantly
    this.#filesStore.files.set({});
    this.unsavedFiles.set(new Set());
    this.modifiedFiles = new Set();
    this.currentView.set('code');

    try {
      const wc = await webcontainer;

      // Wipe workdir contents — delete everything inside so the next chat starts clean.
      // Preserve the workdir directory itself (wc.workdir) to avoid remount issues.
      // NOTE: do NOT kill processes here — kill -9 -- -1 breaks the shell spawner.
      const rm = await wc.spawn('sh', ['-c', `rm -rf "${wc.workdir}"/* "${wc.workdir}"/.[!.]* "${wc.workdir}"/..?*`]);
      await rm.exit;
    } catch {
      // best-effort — if cleanup fails the snapshot restore on next load will overwrite
    }
  }

  /**
   * Day 9b — write a restored snapshot's files straight into the WebContainer FS, bypassing
   * message replay (mirrors ActionRunner#runFileAction: mkdir -p + writeFile, and upstream
   * bolt.diy's restoreSnapshot). Snapshot keys are absolute under a per-session workdir, so
   * strip the `/home/<workdir>/` prefix to a workdir-relative path. The FilesStore watcher
   * (`${WORK_DIR}/**`) picks the writes up, so the IDE shows the files without any replay.
   */
  async mountSnapshot(files: Record<string, string>) {
    const wc = await webcontainer;

    for (const [absPath, content] of Object.entries(files)) {
      const relPath = snapshotPathToRelative(absPath);

      if (!relPath) {
        continue;
      }

      const folder = path.dirname(relPath);

      if (folder && folder !== '.') {
        await wc.fs.mkdir(folder, { recursive: true });
      }

      await wc.fs.writeFile(relPath, content);
    }
  }

  addArtifact({ messageId, title, id, type }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(messageId);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(messageId)) {
      this.artifactIdList.push(messageId);
    }

    this.artifacts.setKey(messageId, {
      id,
      title,
      closed: false,
      type,
      runner: new ActionRunner(
        webcontainer,
        () => this.boltTerminal,
        alert => {
          if (this.#reloadedMessages.has(messageId)) {
            return;
          }

          this.enqueueAlert(alert);
        }
      ),
    });
  }

  updateArtifact({ messageId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(messageId, { ...artifact, ...state });
  }
  addAction(data: ActionCallbackData) {
    // this._addAction(data);

    this.addToExecutionQueue(() => this._addAction(data));
  }
  async _addAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    return artifact.runner.addAction(data);
  }

  runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    if (isStreaming) {
      this.actionStreamSampler(data, isStreaming);
    } else {
      this.addToExecutionQueue(() => this._runAction(data, isStreaming));
    }
  }
  async _runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    const action = artifact.runner.actions.get()[data.actionId];

    if (!action || action.executed) {
      return;
    }

    // Day 9b — files already came from the snapshot mount; skip replaying historical FILE
    // writes so we don't overwrite the restore with slow per-file re-writes. Only file actions
    // from reloaded (historical) messages are skipped — shell/start actions still replay so the
    // dev server boots, and new generations (fresh messageIds) are never suppressed.
    if (this.#restoredFromSnapshot && data.action.type === 'file' && this.#reloadedMessages.has(messageId)) {
      artifact.runner.actions.setKey(data.actionId, { ...action, status: 'complete', executed: true });
      return;
    }

    if (data.action.type === 'file') {
      const wc = await webcontainer;
      const fullPath = path.join(wc.workdir, data.action.filePath);

      if (this.selectedFile.value !== fullPath) {
        this.setSelectedFile(fullPath);
      }

      if (this.currentView.value !== 'code') {
        this.currentView.set('code');
      }

      const doc = this.#editorStore.documents.get()[fullPath];

      if (!doc) {
        await artifact.runner.runAction(data, isStreaming);
      }

      this.#editorStore.updateFile(fullPath, data.action.content);

      if (!isStreaming) {
        await artifact.runner.runAction(data);
        this.resetAllFileModifications();
      }
    } else {
      await artifact.runner.runAction(data);
    }
  }

  actionStreamSampler = createSampler(async (data: ActionCallbackData, isStreaming: boolean = false) => {
    return await this._runAction(data, isStreaming);
  }, 100); // TODO: remove this magic number to have it configurable

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
  }

  async downloadZip() {
    const zip = new JSZip();
    const files = this.files.get();
    const { description } = await import('~/lib/persistence/useChatHistory');

    // Get the project name from the description input, or use a default name
    const projectName = (description.value ?? 'project').toLocaleLowerCase().split(' ').join('_');

    // Generate a simple 6-character hash based on the current timestamp
    const timestampHash = Date.now().toString(36).slice(-6);
    const uniqueProjectName = `${projectName}_${timestampHash}`;

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);

        // split the path into segments
        const pathSegments = relativePath.split('/');

        // if there's more than one segment, we need to create folders
        if (pathSegments.length > 1) {
          let currentFolder = zip;

          for (let i = 0; i < pathSegments.length - 1; i++) {
            currentFolder = currentFolder.folder(pathSegments[i])!;
          }
          currentFolder.file(pathSegments[pathSegments.length - 1], dirent.content);
        } else {
          // if there's only one segment, it's a file in the root
          zip.file(relativePath, dirent.content);
        }
      }
    }

    // Generate the zip file and save it
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${uniqueProjectName}.zip`);
  }

  async syncFiles(targetHandle: FileSystemDirectoryHandle) {
    const files = this.files.get();
    const syncedFiles = [];

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);
        const pathSegments = relativePath.split('/');
        let currentHandle = targetHandle;

        for (let i = 0; i < pathSegments.length - 1; i++) {
          currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i], { create: true });
        }

        // create or get the file
        const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1], {
          create: true,
        });

        // write the file content
        const writable = await fileHandle.createWritable();
        await writable.write(dirent.content);
        await writable.close();

        syncedFiles.push(relativePath);
      }
    }

    return syncedFiles;
  }

  async pushToGitHub(repoName: string, commitMessage?: string, githubUsername?: string, ghToken?: string) {
    try {
      // Use cookies if username and token are not provided
      const githubToken = ghToken || Cookies.get('githubToken');
      const owner = githubUsername || Cookies.get('githubUsername');

      if (!githubToken || !owner) {
        throw new Error('GitHub token or username is not set in cookies or provided.');
      }

      // Initialize Octokit with the auth token
      const octokit = new Octokit({ auth: githubToken });

      // Check if the repository already exists before creating it
      let repo: RestEndpointMethodTypes['repos']['get']['response']['data'];

      try {
        const resp = await octokit.repos.get({ owner, repo: repoName });
        repo = resp.data;
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 404) {
          // Repository doesn't exist, so create a new one
          const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: false,
            auto_init: true,
          });
          repo = newRepo;
        } else {
          console.log('cannot create repo!');
          throw error; // Some other error occurred
        }
      }

      // Get all files
      const files = this.files.get();

      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found to push');
      }

      // Create blobs for each file
      const blobs = await Promise.all(
        Object.entries(files).map(async ([filePath, dirent]) => {
          if (dirent?.type === 'file' && dirent.content) {
            const { data: blob } = await octokit.git.createBlob({
              owner: repo.owner.login,
              repo: repo.name,
              content: Buffer.from(dirent.content).toString('base64'),
              encoding: 'base64',
            });
            return { path: extractRelativePath(filePath), sha: blob.sha };
          }

          return null;
        })
      );

      const validBlobs = blobs.filter(Boolean); // Filter out any undefined blobs

      if (validBlobs.length === 0) {
        throw new Error('No valid files to push');
      }

      // Get the latest commit SHA (assuming main branch, update dynamically if needed)
      const { data: ref } = await octokit.git.getRef({
        owner: repo.owner.login,
        repo: repo.name,
        ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
      });
      const latestCommitSha = ref.object.sha;

      // Create a new tree
      const { data: newTree } = await octokit.git.createTree({
        owner: repo.owner.login,
        repo: repo.name,
        base_tree: latestCommitSha,
        tree: validBlobs.map(blob => ({
          path: blob!.path,
          mode: '100644',
          type: 'blob',
          sha: blob!.sha,
        })),
      });

      // Create a new commit
      const { data: newCommit } = await octokit.git.createCommit({
        owner: repo.owner.login,
        repo: repo.name,
        message: commitMessage || 'Initial commit from your app',
        tree: newTree.sha,
        parents: [latestCommitSha],
      });

      // Update the reference
      await octokit.git.updateRef({
        owner: repo.owner.login,
        repo: repo.name,
        ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
        sha: newCommit.sha,
      });

      alert(`Repository created and code pushed: ${repo.html_url}`);
    } catch (error) {
      console.error('Error pushing to GitHub:', error);
      throw error; // Rethrow the error for further handling
    }
  }
}

export const workbenchStore = new WorkbenchStore();

/** Open the workbench on Admin → Logs (embedded Event Logs UI). */
export function openWorkbenchEventLogs(): void {
  workbenchStore.showWorkbench.set(true);
  workbenchStore.currentView.set('admin');
  workbenchStore.adminPanelSection.set('logs');
}
