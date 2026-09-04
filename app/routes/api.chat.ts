import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS, type FileMap } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { WORK_DIR } from '~/utils/constants';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import { optionalAuth, isAuthDisabled } from '~/lib/auth';
import {
  saveChat,
  insertTokenUsageAndConsume,
  getTokenBalanceRemainingForCompany,
  getCompanyIdForChat,
  getCompanyMember,
} from '~/lib/database';
import { personalCompanyId } from '~/lib/database-postgresql';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { getTrialStatusForCompany } from '~/lib/billing/billing-db.server';
import { FREE_TIER_ID, TRIAL_PROMPT_LIMIT } from '~/lib/billing/plans';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

const logger = createScopedLogger('api.chat');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map(cookie => cookie.trim());

  items.forEach(item => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const body = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    customPrompt?: string;
    contextOptimization: boolean;
    chatId?: string;
    urlId?: string;
    description?: string;
    metadata?: any;
  }>();
  const { messages, files, promptId, customPrompt, contextOptimization, chatId, urlId, description, metadata } = body;

  const user = await optionalAuth(request, context);

  // The workspace (company) this prompt bills to — resolved in the gate, reused in onFinish.
  let billingCompanyId: string | null = null;

  /*
   * Go-live guard: every prompt must be attributed to a billable account. When auth
   * is enabled, reject anonymous requests (the /app UI already requires login; this
   * closes the direct-API loophole so usage can't be spent without an account).
   */
  if (!isAuthDisabled(context) && !user?.id) {
    return json({ message: 'Please sign in to use the builder.', code: 'auth_required' }, { status: 401 });
  }

  /*
   * Pre-flight token gate (workspace-scoped). The prompt bills to the workspace that
   * owns the chat's project (or the active workspace for a brand-new chat). All members
   * draw from that one shared pool. Once it's <= 0 we reject the NEXT prompt with 402;
   * the in-flight prompt that drained it still finishes and may overshoot into negative.
   *
   * Exempt: admin bypass / disabled-auth mode and moderators (unlimited), and anonymous
   * requests (handled above).
   */
  if (user?.id && user.id !== 'admin-bypass' && !user.isModerator && !isAuthDisabled(context)) {
    try {
      const personal = personalCompanyId(user.id);
      billingCompanyId =
        (chatId ? await getCompanyIdForChat(chatId) : null) || (await getActiveCompanyId(request, user));

      // Membership check for team workspaces (the personal workspace is always the user's own).
      if (billingCompanyId !== personal) {
        const member = await getCompanyMember(billingCompanyId, user.id);

        if (!member) {
          return json({ message: 'You are not a member of this workspace.', code: 'not_a_member' }, { status: 403 });
        }
      }

      /*
       * Two different meters, depending on the plan.
       *
       * A trial workspace is limited by PROMPTS, not tokens, and the token check is skipped
       * entirely for it. That is deliberate: the trial is a fixed number of demonstrations, and
       * leaving the token gate in place would let a leftover zero balance from the old monthly
       * free tier block someone who still has trial prompts left.
       */
      const trial = await getTrialStatusForCompany(billingCompanyId);

      if (trial && trial.tierId === FREE_TIER_ID) {
        if (trial.promptsUsed >= TRIAL_PROMPT_LIMIT) {
          return json(
            {
              message: `Your free trial is over — you've used all ${TRIAL_PROMPT_LIMIT} prompts. Choose a plan to keep building.`,
              code: 'trial_exhausted',
              promptsUsed: trial.promptsUsed,
              promptLimit: TRIAL_PROMPT_LIMIT,
            },
            { status: 402 }
          );
        }
      } else {
        const remaining = await getTokenBalanceRemainingForCompany(billingCompanyId, user.id);

        if (remaining <= 0) {
          return json(
            {
              message:
                'This workspace has run out of tokens for the billing period. Upgrade the plan to keep building.',
              code: 'token_balance_exhausted',
              remaining,
            },
            { status: 402 }
          );
        }
      }
    } catch (e) {
      // Never let a metering hiccup hard-block paying users — log and allow through.
      logger.error('Token balance pre-flight check failed; allowing request', e);
    }
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}'
  );

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const extractText = (msg: { content: string | Array<{ type?: string; text?: string }> }) =>
      Array.isArray(msg.content)
        ? (msg.content.find((p: any) => p.type === 'text')?.text as string) || ''
        : (msg.content as string) || '';
    const totalMessageContent = messages.reduce((acc, message) => acc + extractText(message), '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    let lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        const triggeringMessageId = messages.filter((x: any) => x.role === 'user').slice(-1)[0]?.id;

        if (user?.id && chatId) {
          // fire-and-forget — persisting chat history must not block streaming
          saveChat(user.id, {
            id: chatId,
            urlId,
            description,
            messages,
            metadata: metadata ?? {},
          }).catch(e => logger.debug('Could not ensure chat exists for token recording', e));
        }

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        if (messages.length > 3) {
          messageSliceId = messages.length - 3;
        }

        if (filePaths.length > 0 && contextOptimization) {
          try {
            logger.debug('Generating Chat Summary');
            dataStream.writeData({
              type: 'progress',
              label: 'summary',
              status: 'in-progress',
              order: progressCounter++,
              message: 'Analysing Request',
            } satisfies ProgressAnnotation);

            // Create a summary of the chat
            console.log(`Messages count: ${messages.length}`);

            summary = await createSummary({
              messages: [...messages],
              env: context.cloudflare?.env,
              apiKeys,
              providerSettings,
              promptId,
              contextOptimization,
              onFinish(resp) {
                if (resp.usage) {
                  logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                  cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                  cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                  cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
                }
              },
            });
            dataStream.writeData({
              type: 'progress',
              label: 'summary',
              status: 'complete',
              order: progressCounter++,
              message: 'Analysis Complete',
            } satisfies ProgressAnnotation);

            dataStream.writeMessageAnnotation({
              type: 'chatSummary',
              summary,
              chatId: messages.slice(-1)?.[0]?.id,
            } as ContextAnnotation);

            // Update context buffer
            logger.debug('Updating Context Buffer');
            dataStream.writeData({
              type: 'progress',
              label: 'context',
              status: 'in-progress',
              order: progressCounter++,
              message: 'Determining Files to Read',
            } satisfies ProgressAnnotation);

            // Select context files
            console.log(`Messages count: ${messages.length}`);
            filteredFiles = await selectContext({
              messages: [...messages],
              env: context.cloudflare?.env,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              summary,
              onFinish(resp) {
                if (resp.usage) {
                  logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                  cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                  cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                  cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
                }
              },
            });

            if (filteredFiles) {
              logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
            }

            dataStream.writeMessageAnnotation({
              type: 'codeContext',
              files: Object.keys(filteredFiles).map(key => {
                let path = key;

                if (path.startsWith(WORK_DIR)) {
                  path = path.replace(WORK_DIR, '');
                }

                return path;
              }),
            } as ContextAnnotation);

            dataStream.writeData({
              type: 'progress',
              label: 'context',
              status: 'complete',
              order: progressCounter++,
              message: 'Code Files Selected',
            } satisfies ProgressAnnotation);
          } catch (summaryOrContextError: any) {
            logger.warn(
              'Context optimization failed (summary/selectContext), proceeding without. Error:',
              summaryOrContextError?.message
            );
            dataStream.writeData({
              type: 'progress',
              label: summary ? 'context' : 'summary',
              status: 'complete',
              order: progressCounter++,
              message: 'Skipped (continuing with response)',
            } satisfies ProgressAnnotation);
          }
        }

        // Stream the text
        const options: StreamingOptions = {
          toolChoice: 'none',
          onFinish: async ({ text: content, finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              const totalTokens = cumulativeUsage.totalTokens;

              if (user?.id && chatId && triggeringMessageId && totalTokens > 0) {
                const lastUserMessage = messages.filter((x: any) => x.role === 'user').slice(-1)[0];
                const { model, provider } = lastUserMessage
                  ? extractPropertiesFromMessage(lastUserMessage)
                  : { model: undefined, provider: undefined };

                try {
                  const recorded = await insertTokenUsageAndConsume({
                    chatId,
                    messageId: triggeringMessageId,
                    userId: user.id,
                    companyId: billingCompanyId,
                    promptTokens: cumulativeUsage.promptTokens,
                    completionTokens: cumulativeUsage.completionTokens,
                    totalTokens,
                    model,
                    provider,
                  });

                  if (!recorded) {
                    logger.debug(
                      'Token usage + balance/allocations not recorded (failed transaction or duplicate chat/message)'
                    );
                  }
                } catch (e) {
                  logger.debug('Failed to record token usage', e);
                }
              }

              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise(resolve => setTimeout(resolve, 0));

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            const lastUserMessage = messages.filter(x => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);
            messages.push({ id: generateId(), role: 'assistant', content });
            messages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages,
              env: context.cloudflare?.env,
              options,
              apiKeys,
              files,
              providerSettings,
              promptId,
              customPrompt,
              contextOptimization,
              contextFiles: filteredFiles,
              summary,
              messageSliceId,
              chatId,
            });

            result.mergeIntoDataStream(dataStream);

            (async () => {
              for await (const part of result.fullStream) {
                if (part.type === 'error') {
                  const error: any = part.error;
                  logger.error(`${error}`);

                  return;
                }
              }
            })();

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const result = await streamText({
          messages,
          env: context.cloudflare?.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          customPrompt,
          contextOptimization,
          contextFiles: filteredFiles,
          summary,
          messageSliceId,
          chatId,
        });

        (async () => {
          for await (const part of result.fullStream) {
            if (part.type === 'error') {
              const error: any = part.error;
              logger.error(`${error}`);

              return;
            }
          }
        })();
        result.mergeIntoDataStream(dataStream);
      },
      onError: (error: any) => `Custom error: ${error.message}`,
    }).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          if (!lastChunk) {
            lastChunk = ' ';
          }

          if (typeof chunk === 'string') {
            if (chunk.startsWith('g') && !lastChunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "<div class=\\"__boltThought__\\">"\n`));
            }

            if (lastChunk.startsWith('g') && !chunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "</div>\\n"\n`));
            }
          }

          lastChunk = chunk;

          let transformedChunk = chunk;

          if (typeof chunk === 'string' && chunk.startsWith('g')) {
            let content = chunk.split(':').slice(1).join(':');

            if (content.endsWith('\n')) {
              content = content.slice(0, content.length - 1);
            }

            transformedChunk = `0:${content}\n`;
          }

          // Convert the string stream to a byte stream
          const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
          controller.enqueue(encoder.encode(str));
        },
      })
    );

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    logger.error(error);

    if (error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
