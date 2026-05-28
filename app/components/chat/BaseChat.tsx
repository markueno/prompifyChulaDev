/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { JSONValue, Message } from 'ai';
import React, { type RefCallback, useCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST, isImportChatHidden, isImportFolderHidden, isGitCloneHidden } from '~/utils/constants';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';
import { APIKeyManager, getApiKeysFromCookies } from './APIKeyManager';
import Cookies from 'js-cookie';
import * as Tooltip from '@radix-ui/react-tooltip';

import styles from './BaseChat.module.scss';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { ImportButtons } from '~/components/chat/chatExportAndImport/ImportButtons';
import { ExamplePrompts } from '~/components/chat/ExamplePrompts';
import GitCloneButton from './GitCloneButton';

import FilePreview from './FilePreview';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import type { ProviderInfo } from '~/types/model';
import { ScreenshotStateManager } from './ScreenshotStateManager';
import { toast } from 'react-toastify';
import StarterTemplates from './StarterTemplates';
import type { ActionAlert } from '~/types/actions';
import ChatAlert from './ChatAlert';
import type { ModelInfo } from '~/lib/modules/llm/types';
import ProgressCompilation from './ProgressCompilation';
import type { ProgressAnnotation } from '~/types/context';
import type { ActionRunner } from '~/lib/runtime/action-runner';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import { PromptingMultipleChoice } from './PromptingMultipleChoice';

const TEXTAREA_MIN_HEIGHT = 76;

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  setInput?: (value: string) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
  exportChat?: () => void;
  uploadedFiles?: File[];
  setUploadedFiles?: (files: File[]) => void;
  imageDataList?: string[];
  setImageDataList?: (dataList: string[]) => void;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
  data?: JSONValue[] | undefined;
  actionRunner?: ActionRunner;
  /** When false, LLM/provider dropdown, model selection, and API key UI are hidden; defaults to Anthropic + Claude Sonnet 4.6 */
  isModerator?: boolean;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      onStreamingChange,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',
      enhancingPrompt,
      handleInputChange,

      // promptEnhanced,
      enhancePrompt,
      sendMessage,
      handleStop,
      importChat,
      exportChat,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
      actionAlert,
      clearAlert,
      data,
      actionRunner,
      isModerator = false,
      setInput,
    },
    ref
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const [apiKeys, setApiKeys] = useState<Record<string, string>>(getApiKeysFromCookies());
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isModelSettingsCollapsed, setIsModelSettingsCollapsed] = useState(true);
    const [isListening, setIsListening] = useState(false);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
    const modelRef = React.useRef(model);
    modelRef.current = model;
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);

    const setWizardPrompt = (prompt: string) => {
      if (setInput) {
        setInput(prompt);
      } else if (handleInputChange) {
        handleInputChange({ target: { value: prompt } } as React.ChangeEvent<HTMLTextAreaElement>);
      }
    };

    useEffect(() => {
      if (data) {
        const progressList = data.filter(
          x => typeof x === 'object' && (x as any).type === 'progress'
        ) as ProgressAnnotation[];
        setProgressAnnotations(progressList);
      }
    }, [data]);

    useEffect(() => {
      console.log(transcript);
    }, [transcript]);

    useEffect(() => {
      onStreamingChange?.(isStreaming);
    }, [isStreaming, onStreamingChange]);

    useEffect(() => {
      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = event => {
          const transcript = Array.from(event.results)
            .map(result => result[0])
            .map(result => result.transcript)
            .join('');

          setTranscript(transcript);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        };

        recognition.onerror = event => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        setRecognition(recognition);
      }
    }, []);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        let parsedApiKeys: Record<string, string> | undefined = {};

        try {
          parsedApiKeys = getApiKeysFromCookies();
          setApiKeys(parsedApiKeys);
        } catch (error) {
          console.error('Error loading API keys from cookies:', error);
          Cookies.remove('apiKeys');
        }

        const ollamaProvider = providerList?.find(p => p.name === 'Ollama');
        const isOllamaSelected = provider?.name === 'Ollama';

        if (isOllamaSelected && ollamaProvider) {
          // Only fetch Ollama when it's selected; fetch base list (excl. Ollama) + Ollama in parallel
          // Uses server cache for Ollama (no cache buster)
          setIsModelLoading('Ollama');
          Promise.all([
            fetch('/api/models?excludeProviders=Ollama').then(r => r.json()),
            fetch('/api/models/Ollama').then(r => r.json()),
          ])
            .then(([baseData, ollamaData]) => {
              const baseModels = (baseData as { modelList: ModelInfo[] }).modelList;
              const ollamaModels = (ollamaData as { modelList: ModelInfo[] }).modelList;
              setModelList([...baseModels, ...ollamaModels]);
              if (setModel) {
                const currentModel = modelRef.current;
                const currentInOllama = currentModel && ollamaModels.some(m => m.name === currentModel);
                if (!currentInOllama && ollamaModels.length > 0) {
                  const modelToUse = ollamaModels[0].name;
                  if (modelToUse) {
                    setModel(modelToUse);
                    Cookies.set('selectedModel', modelToUse, { expires: 30 });
                  }
                }
              }
            })
            .catch(error => {
              console.error('Error fetching models:', error);
            })
            .finally(() => setIsModelLoading(undefined));
        } else {
          // Fetch all models except Ollama (Ollama fetched only when selected)
          setIsModelLoading('all');
          fetch(ollamaProvider ? '/api/models?excludeProviders=Ollama' : '/api/models')
            .then(response => response.json())
            .then(data => {
              const typedData = data as { modelList: ModelInfo[] };
              const allModels = typedData.modelList;
              setModelList(allModels);
              // When switching to non-Ollama, only set default if current model isn't valid for this provider
              if (provider && setModel) {
                const currentModel = modelRef.current;
                const modelsForProvider = allModels.filter(m => m.provider === provider.name);
                const currentInProvider = currentModel && modelsForProvider.some(m => m.name === currentModel);
                if (!currentInProvider && modelsForProvider.length > 0) {
                  const firstForProvider = modelsForProvider[0];
                  setModel(firstForProvider.name);
                  Cookies.set('selectedModel', firstForProvider.name, { expires: 30 });
                }
              }
            })
            .catch(error => {
              console.error('Error fetching model list:', error);
            })
            .finally(() => setIsModelLoading(undefined));
        }
      }
    }, [providerList, provider]);

    const onApiKeysChange = async (providerName: string, apiKey: string) => {
      const newApiKeys = { ...apiKeys, [providerName]: apiKey };
      setApiKeys(newApiKeys);
      Cookies.set('apiKeys', JSON.stringify(newApiKeys));

      setIsModelLoading(providerName);

      let providerModels: ModelInfo[] = [];

      try {
        const response = await fetch(`/api/models/${encodeURIComponent(providerName)}`);
        const data = await response.json();
        providerModels = (data as { modelList: ModelInfo[] }).modelList;
      } catch (error) {
        console.error('Error loading dynamic models for:', providerName, error);
      }

      // Only update models for the specific provider
      setModelList(prevModels => {
        const otherModels = prevModels.filter(model => model.provider !== providerName);
        return [...otherModels, ...providerModels];
      });
      setIsModelLoading(undefined);
    };

    const refreshOllamaModels = useCallback(async () => {
      if (provider?.name !== 'Ollama') {
        return;
      }

      setIsModelLoading('Ollama');

      try {
        // Fetch fresh models for Ollama with timestamp to bypass cache
        const response = await fetch(`/api/models/Ollama?t=${Date.now()}`);
        const data = await response.json();
        const providerModels = (data as { modelList: ModelInfo[] }).modelList;

        // Update only Ollama models in the list
        setModelList(prevModels => {
          const otherModels = prevModels.filter(model => model.provider !== 'Ollama');
          return [...otherModels, ...providerModels];
        });
      } catch (error) {
        console.error('Error refreshing Ollama models:', error);
      } finally {
        setIsModelLoading(undefined);
      }
    }, [provider?.name]);

    const startListening = () => {
      if (recognition) {
        recognition.start();
        setIsListening(true);
      }
    };

    const stopListening = () => {
      if (recognition) {
        recognition.stop();
        setIsListening(false);
      }
    };

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (sendMessage) {
        sendMessage(event, messageInput);

        if (recognition) {
          recognition.abort(); // Stop current recognition
          setTranscript(''); // Clear transcript
          setIsListening(false);

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleFileUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async e => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          const reader = new FileReader();

          reader.onload = e => {
            const base64Image = e.target?.result as string;
            setUploadedFiles?.([...uploadedFiles, file]);
            setImageDataList?.([...imageDataList, base64Image]);
          };
          reader.readAsDataURL(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            const reader = new FileReader();

            reader.onload = e => {
              const base64Image = e.target?.result as string;
              setUploadedFiles?.([...uploadedFiles, file]);
              setImageDataList?.([...imageDataList, base64Image]);
            };
            reader.readAsDataURL(file);
          }

          break;
        }
      }
    };

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <div ref={scrollRef} className="flex flex-col lg:flex-row overflow-y-auto w-full h-full">
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] h-full')}>
            {!chatStarted && (
              <div id="intro" className="mt-[16vh] max-w-chat mx-auto text-center px-4 lg:px-0">
                <h1 className="text-3xl lg:text-6xl font-extrabold mb-4 animate-fade-in tracking-tight">
                  <span className="landing-gradient-text" style={{ WebkitTextStroke: '0.6px rgba(255, 255, 255, 0.65)' }}>
                    Where ideas begin
                  </span>
                </h1>
                <p className="text-md lg:text-xl mb-8 text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] animate-fade-in animation-delay-200">
                  Bring ideas to life in seconds or get help on existing projects.
                </p>
              </div>
            )}
            <div
              className={classNames('pt-6 px-2 sm:px-6', {
                'h-full flex flex-col': chatStarted,
              })}
              ref={scrollRef}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-chat pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  ) : null;
                }}
              </ClientOnly>

              {/* Show guided form or chat input */}
              <div
                className={classNames('flex flex-col gap-4 w-full max-w-chat mx-auto z-prompt mb-6', {
                  'sticky bottom-2': chatStarted,
                })}
              >
                  <div className="bg-bolt-elements-background-depth-2">
                    {actionAlert && (
                      <ChatAlert
                        alert={actionAlert}
                        clearAlert={() => clearAlert?.()}
                        postMessage={message => {
                          sendMessage?.({} as any, message);
                          clearAlert?.();
                        }}
                      />
                    )}
                  </div>
                  {progressAnnotations && <ProgressCompilation data={progressAnnotations} />}
                  <div
                    className={classNames(
                      'bg-bolt-elements-background-depth-2 p-3 rounded-lg border border-bolt-elements-borderColor relative w-full max-w-chat mx-auto z-prompt'

                      /*
                       * {
                       *   'sticky bottom-2': chatStarted,
                       * },
                       */
                    )}
                  >
                    <svg className={classNames(styles.PromptEffectContainer)}>
                      <defs>
                        <linearGradient
                          id="line-gradient"
                          x1="20%"
                          y1="0%"
                          x2="-14%"
                          y2="10%"
                          gradientUnits="userSpaceOnUse"
                          gradientTransform="rotate(-45)"
                        >
                          <stop offset="0%" stopColor="#f97316" stopOpacity="0%"></stop>
                          <stop offset="40%" stopColor="#f97316" stopOpacity="80%"></stop>
                          <stop offset="50%" stopColor="#f97316" stopOpacity="80%"></stop>
                          <stop offset="100%" stopColor="#f97316" stopOpacity="0%"></stop>
                        </linearGradient>
                        <linearGradient id="shine-gradient">
                          <stop offset="0%" stopColor="#f97316" stopOpacity="0%"></stop>
                          <stop offset="50%" stopColor="#f97316" stopOpacity="40%"></stop>
                          <stop offset="100%" stopColor="#f97316" stopOpacity="0%"></stop>
                        </linearGradient>
                      </defs>
                      <rect
                        className={classNames(styles.PromptEffectLine)}
                        pathLength="100"
                        strokeLinecap="round"
                      ></rect>
                      <rect className={classNames(styles.PromptShine)} x="48" y="24" width="70" height="1"></rect>
                    </svg>
                    <div>
                      <ClientOnly>
                        {() => (
                          <div className={!isModerator ? '' : isModelSettingsCollapsed ? 'hidden' : ''}>
                            {isModerator ? (
                              <>
                                <ModelSelector
                                  key={provider?.name + ':' + modelList.length}
                                  model={model}
                                  setModel={setModel}
                                  modelList={modelList}
                                  provider={provider}
                                  setProvider={setProvider}
                                  providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                                  apiKeys={apiKeys}
                                  modelLoading={isModelLoading}
                                  onRefreshModels={refreshOllamaModels}
                                />
                                {(providerList || []).length > 0 &&
                                  provider &&
                                  !LOCAL_PROVIDERS.includes(provider.name) && (
                                    <APIKeyManager
                                      provider={provider}
                                      apiKey={apiKeys[provider.name] || ''}
                                      setApiKey={key => {
                                        onApiKeysChange(provider.name, key);
                                      }}
                                    />
                                  )}
                              </>
                            ) : (
                              <div className="mb-2 py-2 px-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textSecondary text-sm">
                                Prompify 2.3 model
                              </div>
                            )}
                          </div>
                        )}
                      </ClientOnly>
                    </div>
                    <FilePreview
                      files={uploadedFiles}
                      imageDataList={imageDataList}
                      onRemove={index => {
                        setUploadedFiles?.(uploadedFiles.filter((_, i) => i !== index));
                        setImageDataList?.(imageDataList.filter((_, i) => i !== index));
                      }}
                    />
                    <ClientOnly>
                      {() => (
                        <ScreenshotStateManager
                          setUploadedFiles={setUploadedFiles}
                          setImageDataList={setImageDataList}
                          uploadedFiles={uploadedFiles}
                          imageDataList={imageDataList}
                        />
                      )}
                    </ClientOnly>
                    <div
                      className={classNames(
                        'relative shadow-xs border border-bolt-elements-borderColor backdrop-blur rounded-lg'
                      )}
                    >
                      {!chatStarted ? (
                        <PromptingMultipleChoice
                          onPromptChange={setWizardPrompt}
                        />
                      ) : (
                        // Original textarea for chat mode
                        <textarea
                          ref={textareaRef}
                          className={classNames(
                            'w-full pl-4 pt-4 pr-16 outline-none resize-none text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent text-sm',
                            'transition-all duration-200',
                            'hover:border-bolt-elements-focus'
                          )}
                          onDragEnter={e => {
                            e.preventDefault();
                            e.currentTarget.style.border = '2px solid #1488fc';
                          }}
                          onDragOver={e => {
                            e.preventDefault();
                            e.currentTarget.style.border = '2px solid #1488fc';
                          }}
                          onDragLeave={e => {
                            e.preventDefault();
                            e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';
                          }}
                          onDrop={e => {
                            e.preventDefault();
                            e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';

                            const files = Array.from(e.dataTransfer.files);
                            files.forEach(file => {
                              if (file.type.startsWith('image/')) {
                                const reader = new FileReader();

                                reader.onload = e => {
                                  const base64Image = e.target?.result as string;
                                  setUploadedFiles?.([...uploadedFiles, file]);
                                  setImageDataList?.([...imageDataList, base64Image]);
                                };
                                reader.readAsDataURL(file);
                              }
                            });
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              if (event.shiftKey) {
                                return;
                              }

                              event.preventDefault();

                              if (isStreaming) {
                                handleStop?.();
                                return;
                              }

                              // ignore if using input method engine
                              if (event.nativeEvent.isComposing) {
                                return;
                              }

                              handleSendMessage?.(event);
                            }
                          }}
                          value={input}
                          onChange={event => {
                            handleInputChange?.(event);
                          }}
                          onPaste={handlePaste}
                          style={{
                            minHeight: TEXTAREA_MIN_HEIGHT,
                            maxHeight: TEXTAREA_MAX_HEIGHT,
                          }}
                          placeholder="Tell me your dream app idea"
                          translate="no"
                        />
                      )}
                      {/* Send Button - keep inside prompt container bounds */}
                      <ClientOnly>
                        {() => (
                          <SendButton
                            show={chatStarted ? Boolean(input.length > 0 || isStreaming || uploadedFiles.length > 0) : Boolean(input.length > 0)}
                            isStreaming={isStreaming}
                            disabled={!providerList || providerList.length === 0}
                            onClick={event => {
                              if (isStreaming) {
                                handleStop?.();
                                return;
                              }

                              if (chatStarted) {
                                if (input.length > 0 || uploadedFiles.length > 0) {
                                  handleSendMessage?.(event);
                                }
                              } else {
                                if (input.length > 0) {
                                  handleSendMessage?.(event);
                                }
                              }
                            }}
                          />
                        )}
                      </ClientOnly>
                    </div>

                    {/* Action buttons - only show in chat mode */}
                    {chatStarted && (
                      <div className="flex justify-between items-center text-sm p-4 pt-2">
                        <div className="flex gap-1 items-center">
                          <IconButton title="Upload file" className="transition-all" onClick={() => handleFileUpload()}>
                            <div className="i-ph:paperclip text-xl"></div>
                          </IconButton>
                          <IconButton
                            title="Enhance prompt"
                            disabled={input.length === 0 || enhancingPrompt}
                            className={classNames('transition-all', enhancingPrompt ? 'opacity-100' : '')}
                            onClick={() => {
                              enhancePrompt?.();
                              toast.success('Prompt enhanced!');
                            }}
                          >
                            {enhancingPrompt ? (
                              <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl animate-spin"></div>
                            ) : (
                              <div className="i-bolt:stars text-xl"></div>
                            )}
                          </IconButton>

                          <SpeechRecognitionButton
                            isListening={isListening}
                            onStart={startListening}
                            onStop={stopListening}
                            disabled={isStreaming}
                          />
                          {chatStarted && <ClientOnly>{() => <ExportChatButton exportChat={exportChat} />}</ClientOnly>}
                          {isModerator && (
                            <IconButton
                              title="Model Settings"
                              className={classNames('transition-all flex items-center gap-1', {
                                'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent':
                                  isModelSettingsCollapsed,
                                'bg-bolt-elements-item-backgroundDefault text-bolt-elements-item-contentDefault':
                                  !isModelSettingsCollapsed,
                              })}
                              onClick={() => setIsModelSettingsCollapsed(!isModelSettingsCollapsed)}
                              disabled={!providerList || providerList.length === 0}
                            >
                              <div className={`i-ph:caret-${isModelSettingsCollapsed ? 'right' : 'down'} text-lg`} />
                              {isModelSettingsCollapsed ? <span className="text-xs">{model}</span> : <span />}
                            </IconButton>
                          )}
                        </div>
                        {input.length > 3 ? (
                          <div className="text-xs text-bolt-elements-textTertiary">
                            Use{' '}
                            <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Shift</kbd> +{' '}
                            <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Return</kbd>{' '}
                            a new line
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
            </div>
            <div className="flex flex-col justify-center gap-5">
              {!chatStarted && (
                <div className="flex justify-center gap-2">
                  <ImportButtons 
                    importChat={importChat}
                    showImportChat={!isImportChatHidden()}
                    showImportFolder={!isImportFolderHidden()}
                  />
                  <GitCloneButton 
                    importChat={importChat} 
                    show={!isGitCloneHidden()}
                  />
                </div>
              )}
              {!chatStarted &&
                ExamplePrompts((event, messageInput) => {
                  if (isStreaming) {
                    handleStop?.();
                    return;
                  }

                  handleSendMessage?.(event, messageInput);
                })}
              {!chatStarted && <StarterTemplates />}
            </div>
          </div>
          <ClientOnly>
            {() => (
              <Workbench
                actionRunner={actionRunner ?? ({} as ActionRunner)}
                chatStarted={chatStarted}
                isStreaming={isStreaming}
              />
            )}
          </ClientOnly>
        </div>
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  }
);
