import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';

// Extend Window interface to include our custom property
declare global {
  interface Window {
    _tabId?: string;
  }
}

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

// Create a broadcast channel for preview updates
const PREVIEW_CHANNEL = 'preview-updates';

const PROBE_PORTS = [5173, 3000, 4173, 8080, 8000, 4000, 3001, 5000];
const WC_BASE_STORAGE_KEY = 'wc-preview-base';

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #webcontainer: Promise<WebContainer>;
  #broadcastChannel: BroadcastChannel;
  #lastUpdate = new Map<string, number>();
  #refreshTimeouts = new Map<string, NodeJS.Timeout>();
  #REFRESH_DELAY = 500;          // file-change debounce
  #SERVER_READY_DELAY = 30_000; // wait after server-ready before reloading iframe
  #projectBaseUrl: string | null = null; // e.g. https://abc123.local-credentialless.webcontainer-api.io

  previews = atom<PreviewInfo[]>([]);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;
    this.#broadcastChannel = new BroadcastChannel(PREVIEW_CHANNEL);

    // Listen for preview updates from other tabs
    this.#broadcastChannel.onmessage = event => {
      const { type, previewId } = event.data;

      if (type === 'file-change') {
        const timestamp = event.data.timestamp;
        const lastUpdate = this.#lastUpdate.get(previewId) || 0;

        if (timestamp > lastUpdate) {
          this.#lastUpdate.set(previewId, timestamp);
          this.refreshPreview(previewId);
        }
      }
    };

    this.#init();
  }

  // Generate a unique ID for this tab
  private _getTabId(): string {
    if (typeof window !== 'undefined') {
      if (!window._tabId) {
        window._tabId = Math.random().toString(36).substring(2, 15);
      }

      return window._tabId;
    }

    return '';
  }

  async #init() {
    const webcontainer = await this.#webcontainer;

    // Listen for server ready events
    webcontainer.on('server-ready', (port, url) => {
      console.log('[Preview] Server ready on port:', port, url);
      console.log('[Preview] WebContainer workdir:', webcontainer.workdir);
      console.log('[Preview] Session ID:', typeof window !== 'undefined' && window.sessionStorage
        ? window.sessionStorage.getItem('bolt-session-id')
        : 'N/A');

      // Persist base URL so port-polling can use it even after a page refresh
      this.#captureBaseUrl(url);

      // BroadcastChannel.onmessage does NOT fire in the same tab that sent the message,
      // so call refreshPreview directly for the current tab, then broadcast to others.
      // Use the longer server-ready delay: the dev server reports "ready" before its
      // initial build/compile pass finishes, so the iframe needs time before loading.
      const previewId = this.getPreviewId(url);

      if (previewId) {
        this.refreshPreview(previewId, this.#SERVER_READY_DELAY);
      }

      this.broadcastUpdate(url);
    });

    try {
      // Watch for file changes
      const watcher = await webcontainer.fs.watch('**/*', { persistent: true });

      // Use the native watch events
      (watcher as any).addEventListener('change', async () => {
        const previews = this.previews.get();

        for (const preview of previews) {
          const previewId = this.getPreviewId(preview.baseUrl);

          if (previewId) {
            // Direct call for the current tab (BroadcastChannel won't self-deliver)
            this.refreshPreview(previewId);
            this.broadcastFileChange(previewId);
          }
        }
      });

    } catch (error) {
      console.error('[Preview] Error setting up watchers:', error);
    }

    // Listen for port events
    webcontainer.on('port', (port, type, url) => {
      let previewInfo = this.#availablePreviews.get(port);

      if (type === 'close' && previewInfo) {
        this.#availablePreviews.delete(port);
        this.previews.set(this.previews.get().filter(preview => preview.port !== port));

        return;
      }

      const previews = this.previews.get();

      if (!previewInfo) {
        previewInfo = { port, ready: type === 'open', baseUrl: url };
        this.#availablePreviews.set(port, previewInfo);
        previews.push(previewInfo);
      }

      previewInfo.ready = type === 'open';
      previewInfo.baseUrl = url;

      this.previews.set([...previews]);

      if (type === 'open') {
        this.#captureBaseUrl(url);
        this.broadcastUpdate(url);
      }
    });

    // Port-polling fallback: if the port/server-ready events never fire (e.g. the dev
    // server started but WebContainer missed the event), probe common ports using the
    // base URL from sessionStorage. Schedule several attempts to cover slow installs.
    [45_000, 90_000, 135_000, 180_000].forEach(delay => {
      setTimeout(() => this.#pollCommonPorts(), delay);
    });
  }

  // Strip the port suffix from a WebContainer URL to get the project base URL.
  // https://abc123-5173.local-credentialless.webcontainer-api.io
  //   → https://abc123.local-credentialless.webcontainer-api.io
  #extractBaseUrl(portUrl: string): string | null {
    try {
      return portUrl.replace(/-\d+\.local-credentialless/, '.local-credentialless') || null;
    } catch {
      return null;
    }
  }

  // Capture and persist the base URL on the first successful port/server-ready event.
  #captureBaseUrl(portUrl: string) {
    if (this.#projectBaseUrl) return;

    const base = this.#extractBaseUrl(portUrl);

    if (base) {
      this.#projectBaseUrl = base;

      try {
        sessionStorage.setItem(WC_BASE_STORAGE_KEY, base);
      } catch {}
    }
  }

  // Probe common dev-server ports. Constructs URLs from the stored base URL so it
  // works even when no port/server-ready event fired in this session.
  async #pollCommonPorts() {
    if (this.#availablePreviews.size > 0) return; // already have a preview

    // Recover base URL from last successful session if not yet seen this session
    if (!this.#projectBaseUrl) {
      try {
        this.#projectBaseUrl = sessionStorage.getItem(WC_BASE_STORAGE_KEY);
      } catch {}
    }

    if (!this.#projectBaseUrl) return; // can't construct URLs without a base

    for (const port of PROBE_PORTS) {
      if (this.#availablePreviews.has(port)) continue;

      const url = this.#projectBaseUrl.replace('.local-credentialless', `-${port}.local-credentialless`);

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timer);

        // Any HTTP response (even 4xx/5xx) means a server is listening on this port
        if (res.status > 0) {
          console.log(`[Preview] Port poll: server found on port ${port} (HTTP ${res.status})`);

          const previewInfo: PreviewInfo = { port, ready: true, baseUrl: url };
          this.#availablePreviews.set(port, previewInfo);

          const previews = this.previews.get();
          previews.push(previewInfo);
          this.previews.set([...previews]);

          break; // Stop after first found port
        }
      } catch {
        // AbortError or network error — port not open
      }
    }
  }

  // Helper to extract preview ID from URL
  getPreviewId(url: string): string | null {
    const match = url.match(/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/);
    return match ? match[1] : null;
  }

  // Broadcast state change to all tabs
  broadcastStateChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);

    this.#broadcastChannel.postMessage({
      type: 'state-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast file change to all tabs
  broadcastFileChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);

    this.#broadcastChannel.postMessage({
      type: 'file-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast update to all tabs
  broadcastUpdate(url: string) {
    const previewId = this.getPreviewId(url);

    if (previewId) {
      const timestamp = Date.now();
      this.#lastUpdate.set(previewId, timestamp);

      this.#broadcastChannel.postMessage({
        type: 'file-change',
        previewId,
        timestamp,
      });
    }
  }

  // Method to refresh a specific preview
  refreshPreview(previewId: string, delay = this.#REFRESH_DELAY) {
    // Clear any pending refresh for this preview
    const existingTimeout = this.#refreshTimeouts.get(previewId);

    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set a new timeout for this refresh
    const timeout = setTimeout(() => {
      const previews = this.previews.get();
      const preview = previews.find(p => this.getPreviewId(p.baseUrl) === previewId);

      if (preview) {
        preview.ready = false;
        this.previews.set([...previews]);

        requestAnimationFrame(() => {
          preview.ready = true;
          this.previews.set([...previews]);
        });
      }

      this.#refreshTimeouts.delete(previewId);
    }, delay);

    this.#refreshTimeouts.set(previewId, timeout);
  }
}

// Create a singleton instance
let previewsStore: PreviewsStore | null = null;

export function usePreviewStore() {
  if (!previewsStore) {
    /*
     * Initialize with a Promise that resolves to WebContainer
     * This should match how you're initializing WebContainer elsewhere
     */
    previewsStore = new PreviewsStore(Promise.resolve({} as WebContainer));
  }

  return previewsStore;
}
