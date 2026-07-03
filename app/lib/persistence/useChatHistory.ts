import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useMemo, useRef } from 'react';
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
  queueWrite,
  duplicateChat,
  createChatFromMessages,
  type IChatMetadata,
} from './db';
import { buildSnapshot } from '~/lib/snapshots/buildSnapshot';
import { uploadBlobs } from '~/lib/snapshots/uploadBlobs';
import { loadSnapshot } from '~/lib/snapshots/loadSnapshot';
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
 * Day 9b fix — trigger a debounced snapshot save from outside the chat-message flow
 * (e.g. after a manual file edit in the workbench). Reads chatId + description from
 * the live nanostore atoms so the caller doesn't need them. Flag-gated and best-effort
 * (failure is swallowed, never blocks the file save).
 */
export function scheduleSnapshotSave(): void {
  if (!snapshotsEnabled) {
    return;
  }

  const id = chatId.get();

  if (!id) {
    return;
  }

  if (snapshotSaveTimer) {
    clearTimeout(snapshotSaveTimer);
  }

  const descriptionText = description.get();
  snapshotSaveTimer = setTimeout(() => {
    void saveCodebaseSnapshot(id, descriptionText);
  }, 3000);
}

/**
 * Build a content-addressed snapshot of the current WebContainer file state and persist it:
 * dedup -> upload only missing blobs to object storage -> save a version row -> cache full
 * content in IndexedDB for instant restore. Best-effort and fully isolated: any failure here
 * is swallowed so it can NEVER break the chat-history save it runs after. The matching restore
 * path (loadSnapshot -> mount -> suppress file replay) is wired into loadChat() below (Day 9b).
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

    // Day 10 — server-side operations wrapped so any failure queues a pending write for
    // retry on reconnect (Day 11 drain). IndexedDB cache is always updated on server success.
    try {
      const dedupRes = await fetch('/api/snapshots/dedup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes }),
      });

      if (!dedupRes.ok) {
        throw new Error(`Dedup failed: ${dedupRes.status}`);
      }

      const { missing } = (await dedupRes.json()) as { missing: string[] };
      await uploadBlobs(snapshot, missing);

      const versionRes = await fetch(`/api/chats/${id}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: snapshot.manifest, blobs, description: descriptionText }),
      });

      if (!versionRes.ok) {
        throw new Error(`Version save failed: ${versionRes.status}`);
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
    } catch (serverError) {
      console.warn('Snapshot server save failed, enqueuing for retry:', serverError);

      if (db) {
        await queueWrite(db, 'version', id, {
          manifest: snapshot.manifest,
          blobs,
          description: descriptionText,
        });
      }
    }
  } catch (error) {
    // Snapshot is a non-critical sidecar — never let it break chat persistence.
    console.warn('Snapshot save failed (chat save unaffected):', error);
  }
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
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

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
          if (!activeRef.current) {
            return;
          }

          // Day 9b — clear any restore flag from a previously-loaded chat before this load.
          if (snapshotsEnabled) {
            workbenchStore.setRestoredFromSnapshot(false);
          }

          const storedMessages = await getMessages(db, mixedId);

          if (!activeRef.current) {
            return;
          }

          if (storedMessages && storedMessages.messages.length > 0) {
            const rewindId = searchParams.get('rewindTo');
            const filteredMessages = rewindId
              ? storedMessages.messages.slice(0, storedMessages.messages.findIndex(m => m.id === rewindId) + 1)
              : storedMessages.messages;

            // Day 9b — restore + mount the codebase snapshot BEFORE messages are set, so the
            // mount and the file-replay guard are in place before the Chat component replays.
            // A rewind explicitly wants the historical message state, so skip snapshot restore.
            if (snapshotsEnabled && !rewindId) {
              await restoreCodebaseSnapshot(storedMessages.id);
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
                // IndexedDB path above). loadSnapshot handles Tier-1 cache -> Tier-2 server.
                if (snapshotsEnabled && !rewindId) {
                  await restoreCodebaseSnapshot(chat.id);
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
          if (activeRef.current) {
            setReady(true);
          }
        }
      };
      loadChat();
    } else {
      // New chat — save the previous chat's final snapshot, then reset the WebContainer
      // and workbench so each chat gets a fully isolated workspace.
      (async () => {
        const previousId = chatId.get();

        if (snapshotsEnabled && previousId) {
          await saveCodebaseSnapshot(previousId, description.get());
        }

        if (!activeRef.current) {
          return;
        }

        await workbenchStore.resetForNewChat();
        chatId.set(undefined);
        description.set(undefined);

        if (activeRef.current) {
          setReady(true);
        }
      })();
    }

    return () => {
      activeRef.current = false;
    };
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

      // Day 9a — snapshot save (flag-gated, debounced, best-effort).
      if (user?.id) {
        scheduleSnapshotSave();
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
