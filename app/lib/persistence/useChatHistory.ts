import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect } from 'react';
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
  duplicateChat,
  createChatFromMessages,
  type IChatMetadata,
} from './db';

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

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);
export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId, user } = useLoaderData<{ id?: string; user?: any }>();
  const [searchParams] = useSearchParams();

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
          let storedMessages = await getMessages(db, mixedId);
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
            const res = await fetch(`/api/chat/${mixedId}`);
            if (res.ok) {
              const { chat } = await res.json();
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
                  await setMessages(db, chat.id, chat.messages, chat.url_id, chat.description, undefined, chat.metadata);
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
          toast.error(typeof error === 'object' && error && 'message' in error ? String((error as Error).message) : 'Failed to load chat');
        } finally {
          setReady(true);
        }
      };
      loadChat();
    }
  }, [mixedId, user?.id, searchParams, navigate]);

  return {
    ready: !mixedId || ready,
    initialMessages,
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

        navigateChat(urlId);
        setUrlId(urlId);
      }

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      if (initialMessages.length === 0 && !chatId.get()) {
        const nextId = await getNextId(db);

        chatId.set(nextId);

        if (!urlId) {
          navigateChat(nextId);
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
            description: description.get(),
            messages: messages,
            metadata: chatMetadata.get()
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
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        navigate(`/chat/${newId}`);
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
        window.location.href = `/chat/${newId}`;
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

function navigateChat(nextId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(`/chat/${nextId}`, { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
