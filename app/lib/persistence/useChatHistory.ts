import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { atom } from 'nanostores';
import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs';
import {
  getMessages,
  getNextId,
  getUrlId,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  type IChatMetadata,
} from './db';
import { loadSnapshot, loadSnapshotVersion } from '~/lib/snapshots/loadSnapshot';
import { buildProjectChatPath, DEFAULT_PROJECT_ID, resolveProjectIdFromPathname } from '~/utils/chatRoutes';
import { db, snapshotsEnabled, chatId, description, scheduleSnapshotSave } from '~/lib/snapshots/scheduleSnapshot';

// Re-export so the `persistence/index.ts` barrel and direct imports from
// `useChatHistory` continue to resolve these shared atoms.
export { db, chatId, description };

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

/**
 * Day 9b — restore a chat's codebase from its latest snapshot, then mount it into the
 * WebContainer and flag the workbench so historical FILE-write replay is suppressed. Returns
 * true on a successful mount (caller suppresses nothing extra — the guard handles it), false
 * when there is no snapshot or any step fails, in which case the caller falls through to the
 * existing message-replay path (Tier 3). Best-effort and fully isolated: a restore failure
 * must never break chat loading. Must run BEFORE setInitialMessages so the mount + guard are
 * in place before the Chat component replays messages.
 */
/**
 * Day 17 — restore the codebase state mapped to a rewind target. Snapshot versions record the
 * message they were saved after (message_id), so the newest version belonging to any KEPT
 * message is exactly the codebase state at the rewind point. Returns false (→ fall back to
 * message replay) when no mapped version exists — e.g. history from before Day 17.
 */
async function restoreSnapshotForRewind(id: string, keptMessages: Message[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${id}/versions`);

    if (!res.ok) {
      return false;
    }

    const { versions } = (await res.json()) as {
      versions: { versionNumber: number; messageId: string | null }[];
    };

    const keptIds = new Set(keptMessages.map(m => m.id));

    // List is newest-first, so the first hit is the latest state within the kept range.
    const match = versions.find(v => v.messageId !== null && keptIds.has(v.messageId));

    if (!match) {
      return false;
    }

    const snapshot = await loadSnapshotVersion(id, match.versionNumber);

    if (!snapshot) {
      return false;
    }

    await workbenchStore.mountSnapshot(snapshot.files);
    workbenchStore.setRestoredFromSnapshot(true);

    return true;
  } catch (error) {
    console.warn('Rewind snapshot restore failed (falling back to message replay):', error);
    return false;
  }
}

async function restoreCodebaseSnapshot(id: string): Promise<boolean> {
  try {
    const snapshot = await loadSnapshot(id);

    if (!snapshot) {
      return false; // no snapshot (never saved, or unreachable) — fall back to message replay
    }

    await workbenchStore.mountSnapshot(snapshot.files);
    workbenchStore.setRestoredFromSnapshot(true);

    return true;
  } catch (error) {
    console.warn('Snapshot restore failed (falling back to message replay):', error);
    return false;
  }
}

export const chatMetadata = atom<IChatMetadata | undefined>(undefined);

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export function useChatHistory() {
  // Local ref for TypeScript narrowing (module-level const imports aren't narrowed)
  const _hookDb = db;

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
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

    // Local ref for TypeScript narrowing — module-level const imports aren't narrowed.
    const _db = db;

    if (!_db) {
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
          if (!activeRef.current) {
            return;
          }

          // Day 9b — clear any restore flag from a previously-loaded chat before this load.
          if (snapshotsEnabled) {
            workbenchStore.setRestoredFromSnapshot(false);
          }

          const storedMessages = await getMessages(_db, mixedId);

          if (!activeRef.current) {
            return;
          }

          if (storedMessages && storedMessages.messages.length > 0) {
            const rewindId = searchParams.get('rewindTo');
            const filteredMessages = rewindId
              ? storedMessages.messages.slice(0, storedMessages.messages.findIndex(m => m.id === rewindId) + 1)
              : storedMessages.messages;

            /*
             * Day 9b — restore + mount the codebase snapshot BEFORE messages are set, so the
             * mount and the file-replay guard are in place before the Chat component replays.
             * Day 17 — a rewind restores the version MAPPED to the rewind point (exact state,
             * fresh container from the full-page rewind reload); if no mapping exists it
             * falls back to replaying the kept messages, as before.
             */
            if (snapshotsEnabled) {
              if (rewindId) {
                await restoreSnapshotForRewind(storedMessages.id, filteredMessages);
              } else {
                await restoreCodebaseSnapshot(storedMessages.id);
              }
            }

            if (!activeRef.current) {
              return;
            }

            /*
             * Day 9b fix — arm the reloaded-messages set SYNCHRONOUSLY before the messages
             * render. The Chat component's useEffect (Chat.client.tsx) also sets this, but
             * React runs child effects before parent effects, so ChatImpl can start replaying
             * historical actions before that effect fires — letting early FILE writes race the
             * snapshot mount (observed: template files overwrote restored files
             * nondeterministically). Arming here closes that window; the useEffect stays as a
             * safety net for subsequent message updates.
             */
            workbenchStore.setReloadedMessages(filteredMessages.map((m: Message) => m.id));

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

                // Day 9b — restore from snapshot before setting messages (same as the
                // IndexedDB path above). Day 17 — rewinds restore the mapped version.
                if (snapshotsEnabled) {
                  if (rewindId) {
                    await restoreSnapshotForRewind(chat.id, filteredMessages);
                  } else {
                    await restoreCodebaseSnapshot(chat.id);
                  }
                }

                if (!activeRef.current) {
                  return;
                }

                // Day 9b fix — same synchronous guard arming as the IndexedDB path above.
                workbenchStore.setReloadedMessages(filteredMessages.map((m: Message) => m.id));

                setInitialMessages(filteredMessages);
                setUrlId(chat.url_id);
                description.set(chat.description);
                chatId.set(chat.id);
                chatMetadata.set(chat.metadata);

                if (_db) {
                  await setMessages(
                    _db,
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
          if (activeRef.current) {
            setReady(true);
          }
        }
      };
      loadChat();
    } else {
      /*
       * New chat — nothing to load. "Start new chat" is a hard <a> navigation (full page
       * load), which already resets chatId, the workbench stores, and the WebContainer
       * itself, so no manual reset is needed here. (A previous in-effect reset wiped the
       * container workdir asynchronously and could race the first prompt's file writes.)
       * The previous chat's snapshots are saved incrementally by storeMessageHistory /
       * scheduleSnapshotSave during the chat itself.
       */
      setReady(true);
    }

    return () => {
      activeRef.current = false;
    };
  }, [activeProjectId, mixedId, user?.id, searchParams, navigate]);

  const ensureChatId = async (): Promise<string | undefined> => {
    if (!_hookDb) {
      return chatId.get();
    }

    const current = chatId.get();

    if (current) {
      return current;
    }

    const nextId = await getNextId(_hookDb);
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

      if (!_hookDb || !id) {
        return;
      }

      try {
        await setMessages(_hookDb, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: async (messages: Message[]) => {
      if (!_hookDb || messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;

      if (!urlId && firstArtifact?.id) {
        const urlId = await getUrlId(_hookDb, firstArtifact.id);

        navigateChat(urlId, activeProjectId);
        setUrlId(urlId);
      }

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      if (initialMessages.length === 0 && !chatId.get()) {
        const nextId = await getNextId(_hookDb);

        chatId.set(nextId);

        if (!urlId) {
          navigateChat(nextId, activeProjectId);
        }
      }

      // Save to IndexedDB (existing functionality)
      await setMessages(_hookDb, chatId.get() as string, messages, urlId, description.get(), undefined, chatMetadata.get());

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

      // Day 9a — snapshot save (flag-gated, debounced, best-effort).
      // Day 17 — record the last message id so the version maps to this point in the chat.
      if (user?.id) {
        scheduleSnapshotSave(workbenchStore.files.get(), chatId.get(), messages[messages.length - 1]?.id);
      }
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!_hookDb || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(_hookDb, mixedId || listItemId);
        navigate(buildProjectChatPath(activeProjectId, newId));
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[], metadata?: IChatMetadata) => {
      if (!_hookDb) {
        return;
      }

      try {
        const newId = await createChatFromMessages(_hookDb, description, messages, metadata);
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
      if (!_hookDb || !id) {
        return;
      }

      const chat = await getMessages(_hookDb, id);
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
