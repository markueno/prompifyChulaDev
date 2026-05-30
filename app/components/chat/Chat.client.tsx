/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import { customPromptTemplateStore } from '~/lib/stores/settings';
import type { Message } from 'ai';
import { profileStore } from '~/lib/stores/profile';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { description, chatId, chatMetadata, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import { BuildingOverlay } from '~/components/ui/BuildingOverlay';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { useRouteLoaderData, useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

const MAX_PREVIEW_RECOVERY_ATTEMPTS = 2;
/** After artifact actions go idle, wait this long with no preview before auto follow-up. */
const PREVIEW_RECOVERY_IDLE_MS = 300_000;
/** How often to re-check whether install/shell work is still running. */
const PREVIEW_RECOVERY_POLL_MS = 1_000;

type RecoveryStatus = 'active' | 'waiting-idle' | 'recovering' | 'done' | 'cancelled';
interface RecoveryState {
  attempts: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  status: RecoveryStatus;
}
interface RecoveryHistoryEntry {
  messageId: string;
  status: Extract<RecoveryStatus, 'done' | 'cancelled'>;
  attempts: number;
  endedAt: number;
}
const MAX_RECOVERY_HISTORY = 100;

function getAssistantPlainText(message: Message): string {
  const c = message.content;
  if (typeof c === 'string') {
    return c;
  }
  if (Array.isArray(c)) {
    for (const item of c as ReadonlyArray<{ type?: string; text?: string }>) {
      if (item?.type === 'text' && typeof item.text === 'string') {
        return item.text;
      }
    }
  }
  return '';
}

const PREVIEW_RECOVERY_MARKER = '[Auto-preview-recovery]';
const RECOVERY_CANDIDATE_TIMEOUT_MS = 10_000;

/** Surface Remix JSON error bodies (e.g. 402 token balance) in the same toast format as other chat errors. */
function getChatRequestErrorMessage(error: unknown): string {
  const fallback = 'No details were returned';
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === 'string' && message.length > 0) {
      const trimmed = message.trim();
      if (trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed) as { message?: string };
          if (typeof data.message === 'string' && data.message.length > 0) {
            return data.message;
          }
        } catch {
          /* use raw message */
        }
      }
      return message;
    }
  }
  return fallback;
}

/** Build author info for multi-account prompt history display */
function getMessageAuthor(user: { id?: string; email?: string } | undefined, profile: { nickname?: string; username?: string; avatar?: string } | undefined) {
  const name = (profile?.nickname?.trim() || profile?.username?.trim() || user?.email || 'Anonymous').trim();
  return { id: user?.id || 'anonymous', name, avatar: profile?.avatar };
}

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat, ensureChatId } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map(m => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
          ensureChatId={ensureChatId}
        />
      )}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch(error => toast.error(error.message));
    }
  },
  50
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  ensureChatId: () => Promise<string | undefined>;
  description?: string;
}

const ANTHROPIC_PROVIDER = (PROVIDER_LIST.find(p => p.name === 'Anthropic') || DEFAULT_PROVIDER) as ProviderInfo;

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat, ensureChatId }: ChatProps) => {
    useShortcuts();

    const appIndexData = useRouteLoaderData('routes/app._index') as { user?: { id?: string; email?: string; isModerator?: boolean } } | undefined;
    const appLayoutData = useRouteLoaderData('routes/app') as { user?: { id?: string; email?: string; isModerator?: boolean } } | undefined;
    const chatIdData = useRouteLoaderData('routes/chat.$id') as { user?: { id?: string; email?: string; isModerator?: boolean } } | undefined;
    const user = appIndexData?.user ?? appLayoutData?.user ?? chatIdData?.user;
    const profile = useStore(profileStore);
    useStore(chatId);
    const isModerator = user?.isModerator === true;
    const messageAuthor = getMessageAuthor(user, profile);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const recoveryStatesByMessageIdRef = useRef<Map<string, RecoveryState>>(new Map());
    const recoveryHistoryRef = useRef<RecoveryHistoryEntry[]>([]);
    const pendingRecoveryCandidatesRef = useRef<Set<string>>(new Set());
    const pendingRecoveryTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const chatUiRef = useRef({
      model: DEFAULT_MODEL,
      provider: ANTHROPIC_PROVIDER,
      messageAuthor: getMessageAuthor(user, profile),
      append: null as ((...args: any[]) => any) | null,
    });

    const getOrCreateRecoveryState = useCallback((messageId: string) => {
      const states = recoveryStatesByMessageIdRef.current;
      const existing = states.get(messageId);

      if (existing) {
        return existing;
      }

      const created: RecoveryState = {
        attempts: 0,
        pollTimer: null,
        idleTimer: null,
        status: 'active',
      };
      states.set(messageId, created);
      return created;
    }, []);

    const stopRecovery = useCallback((messageId: string, status: RecoveryStatus = 'cancelled') => {
      const state = recoveryStatesByMessageIdRef.current.get(messageId);
      if (!state) {
        return;
      }

      if (state.pollTimer != null) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }

      if (state.idleTimer != null) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
      }

      state.status = status;

      if (status === 'done' || status === 'cancelled') {
        recoveryHistoryRef.current.push({
          messageId,
          status,
          attempts: state.attempts,
          endedAt: Date.now(),
        });

        if (recoveryHistoryRef.current.length > MAX_RECOVERY_HISTORY) {
          recoveryHistoryRef.current.splice(0, recoveryHistoryRef.current.length - MAX_RECOVERY_HISTORY);
        }

        recoveryStatesByMessageIdRef.current.delete(messageId);
      }
    }, []);

    const stopAllRecoveries = useCallback((status: RecoveryStatus = 'cancelled') => {
      for (const messageId of Array.from(recoveryStatesByMessageIdRef.current.keys())) {
        stopRecovery(messageId, status);
      }
    }, [stopRecovery]);

    const clearPendingRecoveryCandidate = useCallback((messageId: string) => {
      pendingRecoveryCandidatesRef.current.delete(messageId);
      const timeout = pendingRecoveryTimeoutsRef.current.get(messageId);
      if (timeout != null) {
        clearTimeout(timeout);
        pendingRecoveryTimeoutsRef.current.delete(messageId);
      }
    }, []);

    const queueRecoveryCandidate = useCallback(
      (messageId: string) => {
        if (pendingRecoveryCandidatesRef.current.has(messageId)) {
          return;
        }

        pendingRecoveryCandidatesRef.current.add(messageId);
        const timeout = setTimeout(() => {
          clearPendingRecoveryCandidate(messageId);
        }, RECOVERY_CANDIDATE_TIMEOUT_MS);
        pendingRecoveryTimeoutsRef.current.set(messageId, timeout);
      },
      [clearPendingRecoveryCandidate]
    );

    const hasBlockingErrorAlert = useCallback(() => {
      const alert = workbenchStore.alert.get();
      if (!alert) {
        return false;
      }

      // Error path first: if a runtime/terminal error alert is active, pause preview-missing recovery.
      return alert.source === 'preview' || alert.source === 'terminal' || alert.type === 'error';
    }, []);

    const runRecoveryFire = useCallback((messageId: string) => {
      const state = recoveryStatesByMessageIdRef.current.get(messageId);
      if (!state) {
        return;
      }

      if (hasBlockingErrorAlert()) {
        state.status = 'active';
        return;
      }

      if (chatStore.get().aborted) {
        stopRecovery(messageId, 'cancelled');
        return;
      }

      if (state.attempts >= MAX_PREVIEW_RECOVERY_ATTEMPTS) {
        stopRecovery(messageId, 'done');
        return;
      }

      if (workbenchStore.previews.get().length > 0) {
        stopRecovery(messageId, 'done');
        return;
      }

      if (!workbenchStore.showWorkbench.get() || workbenchStore.filesCount === 0) {
        stopRecovery(messageId, 'cancelled');
        return;
      }

      const { append: appendFn, model: m, provider: p, messageAuthor: author } = chatUiRef.current;
      if (!appendFn) {
        return;
      }

      state.attempts += 1;
      state.status = 'recovering';
      workbenchStore.showWorkbench.set(true);
      workbenchStore.currentView.set('preview');

      logger.info('Preview missing after artifact; auto follow-up to restore dev server / preview', {
        attempt: state.attempts,
        messageId,
      });

      toast.info('Preview did not load. Asking the assistant to fix it…');

      appendFn({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[Model: ${m}]\n\n[Provider: ${p.name}]\n\n${PREVIEW_RECOVERY_MARKER} The WebContainer preview did not become available after your last response (no preview was registered). Please: (1) Ensure package.json has a working "dev" script suitable for StackBlitz WebContainers; (2) Run npm/pnpm install if dependencies are missing; (3) Start the dev server with boltArtifact shell/start actions so the preview panel receives a server URL. Fix any errors preventing the dev server from listening. Do not ask the user to open localhost in an external browser—the app must show inside Prompify preview.`,
          },
        ] as any,
        author: author,
      } as any);
    }, [hasBlockingErrorAlert, stopRecovery]);

    const tickRecovery = useCallback(
      (messageId: string) => {
        const state = recoveryStatesByMessageIdRef.current.get(messageId);
        if (!state) {
          return;
        }

        if (hasBlockingErrorAlert()) {
          if (state.idleTimer != null) {
            clearTimeout(state.idleTimer);
            state.idleTimer = null;
          }
          state.status = 'active';
          return;
        }

        if (chatStore.get().aborted) {
          stopRecovery(messageId, 'cancelled');
          return;
        }

        if (workbenchStore.previews.get().length > 0) {
          stopRecovery(messageId, 'done');
          return;
        }

        if (workbenchStore.hasArtifactWorkInProgress(messageId)) {
          if (state.idleTimer != null) {
            clearTimeout(state.idleTimer);
            state.idleTimer = null;
          }
          state.status = 'active';
          return;
        }

        if (state.idleTimer == null) {
          state.status = 'waiting-idle';
          state.idleTimer = setTimeout(() => {
            const latest = recoveryStatesByMessageIdRef.current.get(messageId);
            if (!latest) {
              return;
            }

            latest.idleTimer = null;
            runRecoveryFire(messageId);
          }, PREVIEW_RECOVERY_IDLE_MS);
        }
      },
      [hasBlockingErrorAlert, runRecoveryFire, stopRecovery]
    );

    const startRecovery = useCallback(
      (messageId: string) => {
        stopRecovery(messageId, 'active');
        const state = getOrCreateRecoveryState(messageId);
        state.status = 'active';

        state.pollTimer = setInterval(() => {
          tickRecovery(messageId);
        }, PREVIEW_RECOVERY_POLL_MS);

        tickRecovery(messageId);
      },
      [getOrCreateRecoveryState, stopRecovery, tickRecovery]
    );

    const maybeStartRecoveryFromArtifact = useCallback(
      (messageId: string) => {
        if (!pendingRecoveryCandidatesRef.current.has(messageId)) {
          return false;
        }

        const artifact = workbenchStore.artifacts.get()[messageId];
        if (!artifact) {
          return false;
        }

        clearPendingRecoveryCandidate(messageId);
        startRecovery(messageId);
        return true;
      },
      [clearPendingRecoveryCandidate, startRecovery]
    );

    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const [isInitialBuild, setIsInitialBuild] = useState(false);
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const files = useStore(workbenchStore.files);
    const actionAlert = useStore(workbenchStore.alert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const customPromptTemplate = useStore(customPromptTemplateStore);

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find(p => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    useEffect(() => {
      if (!isModerator) {
        setModel(DEFAULT_MODEL);
        setProvider(ANTHROPIC_PROVIDER);
      }
    }, [isModerator]);

    const { showChat } = useStore(chatStore);

    const [animationScope, animate] = useAnimate();

    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        customPrompt: promptId === 'custom' ? customPromptTemplate : undefined,
        contextOptimization: contextOptimizationEnabled,
        chatId: chatId.get(),
        urlId:
          typeof window !== 'undefined'
            ? (() => {
                const segments = new URL(window.location.href).pathname.split('/').filter(Boolean);
                const last = segments[segments.length - 1];
                return last && last !== 'chat' ? last : undefined;
              })()
            : undefined,
        description: description,
        metadata: chatMetadata.get(),
      },
      sendExtraMessageFields: true,
      onError: e => {
        logger.error('Request failed\n\n', e, error);
        const detail = getChatRequestErrorMessage(e);
        logStore.logError('Chat request failed', e, {
          component: 'Chat',
          action: 'request',
          error: detail,
        });
        toast.error('There was an error processing your request: ' + detail);
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
        queueRecoveryCandidate(message.id);
        maybeStartRecoveryFromArtifact(message.id);
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });

    chatUiRef.current = { model, provider, messageAuthor, append };

    useEffect(() => {
      const prompt = searchParams.get('prompt');
      if (!prompt) return;
      (async () => {
        setSearchParams({});
        await ensureChatId();
        await new Promise(r => setTimeout(r, 0));
        runAnimation();
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
            },
          ] as any, // Type assertion to bypass compiler check
          author: messageAuthor,
        } as any);
      })();
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    // Hide the building overlay once the workbench becomes visible (code starts generating)
    useEffect(() => {
      if (!isInitialBuild) return;
      if (showWorkbench) {
        const t = setTimeout(() => setIsInitialBuild(false), 350);
        return () => clearTimeout(t);
      }
    }, [showWorkbench, isInitialBuild]);

    // Fallback: hide if loading ends without a workbench (e.g. error)
    useEffect(() => {
      if (!isInitialBuild) return;
      if (!isLoading && !fakeLoading) {
        const t = setTimeout(() => setIsInitialBuild(false), 600);
        return () => clearTimeout(t);
      }
    }, [isLoading, fakeLoading, isInitialBuild]);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      await ensureChatId();
      await new Promise(r => setTimeout(r, 0));

      runAnimation();

      if (!chatStarted) {
        setIsInitialBuild(true);
        setFakeLoading(true);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: messageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch(e => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: messageContent,
                  author: messageAuthor,
                } as any,
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                  author: messageAuthor,
                } as any,
              ]);
              reload();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: [
              {
                type: 'text',
                text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
              },
              ...imageDataList.map(imageData => ({
                type: 'image',
                image: imageData,
              })),
            ] as any,
            author: messageAuthor,
          } as any,
        ]);
        reload();
        setFakeLoading(false);

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${messageContent}`,
            },
            ...imageDataList.map(imageData => ({
              type: 'image',
              image: imageData,
            })),
          ] as any,
          author: messageAuthor,
        } as any);

        workbenchStore.resetAllFileModifications();
      } else {
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
            },
            ...imageDataList.map(imageData => ({
              type: 'image',
              image: imageData,
            })),
          ] as any,
                  author: messageAuthor,
                } as any);
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      []
    );

    const [messageRef, scrollRef] = useSnapScroll();

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    useEffect(() => {
      const unsub = workbenchStore.previews.subscribe(previews => {
        if (previews.length > 0) {
          stopAllRecoveries('done');
        }
      });
      return () => {
        unsub();
        stopAllRecoveries('cancelled');
      };
    }, [stopAllRecoveries]);

    useEffect(() => {
      const unsub = workbenchStore.artifacts.subscribe(artifacts => {
        for (const messageId of Array.from(pendingRecoveryCandidatesRef.current)) {
          if (artifacts[messageId]) {
            maybeStartRecoveryFromArtifact(messageId);
          }
        }
      });

      return () => {
        unsub();
        for (const timeout of pendingRecoveryTimeoutsRef.current.values()) {
          clearTimeout(timeout);
        }
        pendingRecoveryTimeoutsRef.current.clear();
        pendingRecoveryCandidatesRef.current.clear();
      };
    }, [maybeStartRecoveryFromArtifact]);

    const handleModelChange = (newModel: string) => {
      if (!isModerator) return;
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      if (!isModerator) return;
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
      // Ollama models are fetched in BaseChat when provider changes; model is set there
    };

    return (
      <>
      <BuildingOverlay visible={isInitialBuild} />
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={streaming => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        isModerator={isModerator}
        messageRef={messageRef}
        scrollRef={scrollRef}
        setInput={setInput}
        handleInputChange={e => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            input => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        data={chatData}
      />
      </>
    );
  }
);
