import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  // Check if we need to clear the cached WebContainer instance
  // This happens when the session ID changes (different browser session)
  const currentSessionId = typeof window !== 'undefined' && window.sessionStorage 
    ? window.sessionStorage.getItem('bolt-session-id') 
    : null;
  
  const cachedSessionId = import.meta.hot?.data.cachedSessionId;
  
  if (cachedSessionId && cachedSessionId !== currentSessionId) {
    console.log('[WebContainer] Session changed, clearing cached instance');
    if (import.meta.hot?.data) {
      import.meta.hot.data.webcontainer = undefined;
      import.meta.hot.data.webcontainerContext = undefined;
    }
  }
  
  // Store the current session ID
  if (import.meta.hot?.data) {
    import.meta.hot.data.cachedSessionId = currentSessionId;
  }

  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(() => {
        console.log('[WebContainer] Booting with workdir:', WORK_DIR_NAME);
        return WebContainer.boot({
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });
      })
      .then(async webcontainer => {
        webcontainerContext.loaded = true;
        console.log('[WebContainer] Booted successfully with workdir:', webcontainer.workdir);

        const { workbenchStore } = await import('~/lib/stores/workbench');

        // Listen for preview errors
        webcontainer.on('preview-message', message => {
          console.log('WebContainer preview message:', message);

          // Handle both uncaught exceptions and unhandled promise rejections
          if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
            const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
            workbenchStore.actionAlert.set({
              type: 'preview',
              title: isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception',
              description: message.message,
              content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
              source: 'preview',
            });
          }
        });

        return webcontainer;
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
