import {
  convertToCoreMessages,
  formatDataStreamPart,
  generateText,
  streamText as _streamText,
  type DataStreamWriter,
  type Message,
} from 'ai';
import { MAX_TOKENS, type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODIFICATIONS_TAG_NAME, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext, extractPropertiesFromMessage } from './utils';
import { getFilePaths } from './select-context';
import { getSchemaContext } from '~/lib/supabase-provision.server';

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

const logger = createScopedLogger('stream-text');

export async function streamText(props: {
  messages: Omit<Message, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  customPrompt?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary?: string;
  messageSliceId?: number;
  chatId?: string;
}) {
  const {
    messages,
    env: serverEnv,
    options,
    apiKeys,
    files,
    providerSettings,
    promptId,
    customPrompt,
    contextOptimization,
    contextFiles,
    summary,
    chatId,
  } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  let processedMessages = messages.map(message => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      return { ...message, content };
    } else if (message.role == 'assistant') {
      let content = message.content;
      content = content.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
      content = content.replace(/<think>.*?<\/think>/s, '');

      return { ...message, content };
    }

    return message;
  });

  let provider = PROVIDER_LIST.find(p => p.name === currentProvider) || DEFAULT_PROVIDER;
  let staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find(m => m.name === currentModel);

  if (!modelDetails) {
    const matchingProvider = PROVIDER_LIST.find(p => (p.staticModels || []).some(m => m.name === currentModel));

    if (matchingProvider && matchingProvider.name !== provider.name) {
      logger.warn(
        `Provider mismatch detected. Requested provider=${provider.name}, model=${currentModel}, resolved provider=${matchingProvider.name}`
      );
      provider = matchingProvider;
      staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
      modelDetails = staticModels.find(m => m.name === currentModel);
    }
  }

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: serverEnv as any,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find(m => m.name === currentModel);

    if (!modelDetails) {
      // Fallback to first model
      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`
      );
      modelDetails = modelsList[0];
    }
  }

  const dynamicMaxTokens = modelDetails && modelDetails.maxTokenAllowed ? modelDetails.maxTokenAllowed : MAX_TOKENS;

  let systemPrompt =
    PromptLibrary.getPropmtFromLibrary(promptId || 'default', {
      cwd: WORK_DIR,
      allowedHtmlElements: allowedHTMLElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
      customPrompt,
    }) ?? getSystemPrompt();

  // Inject the app's database schema so the AI knows what tables exist
  if (chatId) {
    const cfEnv = (serverEnv as unknown as Record<string, unknown>) ?? {};
    const schemaCtx = await getSchemaContext(chatId, cfEnv);

    if (schemaCtx) {
      systemPrompt = `${systemPrompt}\n\n${schemaCtx}`;
    }
  }

  if (files && contextFiles && contextOptimization) {
    const codeContext = createFilesContext(contextFiles, true);
    const filePaths = getFilePaths(files);

    systemPrompt = `${systemPrompt}
Below are all the files present in the project:
---
${filePaths.join('\n')}
---

Below is the artifact containing the context loaded into context buffer for you to have knowledge of and might need changes to fullfill current user request.
CONTEXT BUFFER:
---
${codeContext}
---
`;

    if (summary) {
      systemPrompt = `${systemPrompt}
      below is the chat history till now
CHAT SUMMARY:
---
${props.summary}
---
`;

      if (props.messageSliceId) {
        processedMessages = processedMessages.slice(props.messageSliceId);
      } else {
        const lastMessage = processedMessages.pop();

        if (lastMessage) {
          processedMessages = [lastMessage];
        }
      }
    }
  }

  logger.info(`Sending llm call to ${provider.name} with model ${modelDetails.name}`);

  // Qwen DashScope streaming format differs from OpenAI's SSE — use non-streaming instead
  if (provider.name === 'Qwen') {
    const result = await generateText({
      model: provider.getModelInstance({
        model: modelDetails.name,
        serverEnv,
        apiKeys,
        providerSettings,
      }),
      system: systemPrompt,
      maxTokens: dynamicMaxTokens,
      messages: convertToCoreMessages(processedMessages as any),
    });

    // Wrap non-streaming result in a streaming-compatible shape
    const textContent = result.text;
    const usage = result.usage;
    const finishReason = result.finishReason ?? 'stop';

    return {
      textStream: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(textContent));
          controller.close();
        },
      }) as any,
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: textContent };
        yield { type: 'finish', finishReason, usage };
      })(),
      mergeIntoDataStream(writer: DataStreamWriter) {
        /*
         * Merge a stream so the outer data stream stays open until onFinish has
         * written its annotations (usage, "Response Generated" progress).
         */
        writer.merge(
          new ReadableStream<ReturnType<typeof formatDataStreamPart>>({
            async start(controller) {
              // Message text must be a '0:' text part - writeData() emits a '2:'
              // data part which useChat never renders as assistant content.
              controller.enqueue(formatDataStreamPart('text', textContent));
              controller.enqueue(
                formatDataStreamPart('finish_step', {
                  isContinued: false,
                  finishReason,
                  usage: {
                    promptTokens: usage?.promptTokens ?? 0,
                    completionTokens: usage?.completionTokens ?? 0,
                  },
                })
              );
              controller.enqueue(
                formatDataStreamPart('finish_message', {
                  finishReason,
                  usage: {
                    promptTokens: usage?.promptTokens ?? 0,
                    completionTokens: usage?.completionTokens ?? 0,
                  },
                })
              );

              try {
                await options?.onFinish?.({ text: textContent, finishReason, usage } as any);
              } catch (error) {
                logger.error('Qwen onFinish handler failed', error);
              }

              controller.close();
            },
          })
        );
      },
    } as any;
  }

  return await _streamText({
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
    system: systemPrompt,
    maxTokens: dynamicMaxTokens,
    messages: convertToCoreMessages(processedMessages as any),
    ...options,
  });
}
