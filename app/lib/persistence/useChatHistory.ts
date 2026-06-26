import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useMemo } from 'react';
import { atom } from 'nanostores';
import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs'; // Import logStore
import {
  getMessages,
  getNextId,
  getUrlId,
  openDatabase,
  setMessages,
  setSnapshot,
  duplicateChat,
  createChatFromMessages,
  type IChatMetadata,
} from './db';
import { buildSnapshot } from '~/lib/snapshots/buildSnapshot';
import { uploadBlobs } from '~/lib/snapshots/uploadBlobs';
import { buildProjectChatPath, DEFAULT_PROJECT_ID, resolveProjectIdFromPathname } from '~/utils/chatRoutes';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

// Day 9a — codebase snapshot save (flag-gated, additive). Off by default => exact no-op.
const snapshotsEnabled = import.meta.env.VITE_SNAPSHOTS_ENABLED === 'true';

// Debounce snapshot saves so rapid message growth coalesces into one save (ARCHITECTURE-v2.md:953).
let snapshotSaveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Build a content-addressed snapshot of the current WebContainer file state and persist it:
 * dedup -> upload only missing blobs to object storage -> save a version row -> cache full
 * content in IndexedDB for instant restore. Best-effort and fully isolated: any failure here
 * is swallowed so it can NEVER break the chat-history save it runs after. Restore still uses
 * the existing message-replay path until Day 9b wires loadSnapshot() into loadChat().
 */
async function saveCodebaseSnapshot(id: string, descriptionText: string | undefined): Promise<void> {
  try {
    const snapshot = await buildSnapshot(workbenchStore.files.get());
    const hashes = [...new Set(Object.values(snapshot.manifest))];

    if (hashes.length === 0) {
      return; // nothing to snapshot (e.g. empty workbench)
    }

    // Size per unique blob (sha256 -> bytes), needed by the version-save endpoint.
    const encoder = new TextEncoder();
    const blobs: Record<string, number> = {};

    for (const [path, sha] of Object.entries(snapshot.manifest)) {
      if (blobs[sha] === undefined) {
        blobs[sha] = encoder.encode(snapshot.files[path]).byteLength;
      }
    }

    const dedupRes = await fetch('/api/snapshots/dedup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    });

    if (!dedupRes.ok) {
      console.warn('Snapshot dedup failed:', dedupRes.status);
      return;
    }

    const { missing } = (await dedupRes.json()) as { missing: string[] };
    await uploadBlobs(snapshot, missing);

    const versionRes = await fetch(`/api/chats/${id}/version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: snapshot.manifest, blobs, description: descriptionText }),
    });

    if (!versionRes.ok) {
      console.warn('Snapshot version save failed:', versionRes.status);
      return;
    }

    const { version } = (await versionRes.json()) as { version: number };

    if (db) {
      await setSnapshot(db, {
        chatId: id,
        version,
        manifest: snapshot.manifest,
        files: snapshot.files,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    // Snapshot is a non-critical sidecar — never let it break chat persistence.
    console.warn('Snapshot save failed (chat save unaffected):', error);
  }
}

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);
export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId, user, projectId } = useLoaderData<{ id?: string; projectId?: string; user?: any }>();
  const [searchParams] = useSearchParams();
  const activeProjectId = useMemo(() => {
    if (projectId) {
      return projectId;
    }

    if (typeof window !== 'undefined') {
      return resolveProjectIdFromPathname(window.location.pathname) || DEFAULT_PROJECT_ID;
    }

    return DEFAULT_PROJECT_ID;
  }, [projectId]);

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  useEffect(() => {
    if (!db) {
      setReady(true);

      if (persistenceEnabled) {
        const error = new Error('Chat persistence is unavailable');
        logStore.logError('Chat persistence initialization failed', error);
        toast.error('Chat persistence is unavailable');
      }

      return;
    }

    if (mixedId) {
      const loadChat = async () => {
        try {
          const storedMessages = await getMessages(db, mixedId);

          if (storedMessages && storedMessages.messages.length > 0) {
            const rewindId = searchParams.get('rewindTo');
            const filteredMessages = rewindId
              ? storedMessages.messages.slice(0, storedMessages.messages.findIndex(m => m.id === rewindId) + 1)
              : storedMessages.messages;

            setInitialMessages(filteredMessages);
            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else if (user?.id) {
            const res = await fetch(`/api/chat/${mixedId}?projectId=${encodeURIComponent(activeProjectId)}`);

            if (res.ok) {
              const responseData = (await res.json()) as { chat?: any };
              const { chat } = responseData;

              if (chat?.messages?.length > 0) {
                const rewindId = searchParams.get('rewindTo');
                const filteredMessages = rewindId
                  ? chat.messages.slice(0, chat.messages.findIndex((m: any) => m.id === rewindId) + 1)
                  : chat.messages;
                setInitialMessages(filteredMessages);
                setUrlId(chat.url_id);
                description.set(chat.description);
                chatId.set(chat.id);
                chatMetadata.set(chat.metadata);

                if (db) {
                  await setMessages(
                    db,
                    chat.id,
                    chat.messages,
                    chat.url_id,
                    chat.description,
                    undefined,
                    chat.metadata
                  );
                }
              } else {
                navigate('/', { replace: true });
              }
            } else {
              navigate('/', { replace: true });
            }
          } else {
            navigate('/', { replace: true });
          }
        } catch (error) {
          logStore.logError('Failed to load chat messages', error);
          toast.error(
            typeof error === 'object' && error && 'message' in error
              ? String((error as Error).message)
              : 'Failed to load chat'
          );
        } finally {
          setReady(true);
        }
      };
      loadChat();
    }
  }, [activeProjectId, mixedId, user?.id, searchParams, navigate]);

  const ensureChatId = async (): Promise<string | undefined> => {
    if (!db) {
      return chatId.get();
    }

    const current = chatId.get();

    if (current) {
      return current;
    }

    const nextId = await getNextId(db);
    chatId.set(nextId);

    if (!urlId) {
      navigateChat(nextId, activeProjectId);
    }

    return nextId;
  };

  return {
    ready: !mixedId || ready,
    initialMessages,
    ensureChatId,
    updateChatMestaData: async (metadata: IChatMetadata) => {
      const id = chatId.get();

      if (!db || !id) {
        return;
      }

      try {
        await setMessages(db, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: async (messages: Message[]) => {
      if (!db || messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;

      if (!urlId && firstArtifact?.id) {
        const urlId = await getUrlId(db, firstArtifact.id);

        navigateChat(urlId, activeProjectId);
        setUrlId(urlId);
      }

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      if (initialMessages.length === 0 && !chatId.get()) {
        const nextId = await getNextId(db);

        chatId.set(nextId);

        if (!urlId) {
          navigateChat(nextId, activeProjectId);
        }
      }

      // Save to IndexedDB (existing functionality)
      await setMessages(db, chatId.get() as string, messages, urlId, description.get(), undefined, chatMetadata.get());

      // Also save to PostgreSQL if user is authenticated
      try {
        if (user?.id) {
          const chatData = {
            id: chatId.get() as string,
            url_id: urlId,
            projectId: activeProjectId,
            description: description.get(),
            messages,
            metadata: chatMetadata.get(),
          };

          // Call the API to save to PostgreSQL
          const response = await fetch('/api/chats', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(chatData),
          });

          if (!response.ok) {
            console.warn('Failed to save chat to PostgreSQL:', response.statusText);
          }
        }
      } catch (error) {
        console.warn('Error saving chat to PostgreSQL:', error);
        // Don't throw error - IndexedDB save was successful
      }

      // Day 9a — snapshot save (flag-gated, debounced, best-effort). Fire-and-forget so it
      // never blocks or breaks the chat-history save above.
      if (snapshotsEnabled && user?.id) {
        const id = chatId.get();

        if (id) {
          if (snapshotSaveTimer) {
            clearTimeout(snapshotSaveTimer);
          }

          const descriptionText = description.get();
          snapshotSaveTimer = setTimeout(() => {
            void saveCodebaseSnapshot(id, descriptionText);
          }, 3000);
        }
      }
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        navigate(buildProjectChatPath(activeProjectId, newId));
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[], metadata?: IChatMetadata) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages, metadata);
        window.location.href = buildProjectChatPath(activeProjectId, newId);
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      if (!db || !id) {
        return;
      }

      const chat = await getMessages(db, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(nextId: string, projectId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(buildProjectChatPath(projectId, nextId), { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = buildProjectChatPath(projectId, nextId);

  window.history.replaceState({}, '', url);
}
