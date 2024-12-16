import { streamText as _streamText } from 'ai';
import { getModel } from '~/lib/.server/llm/model';
import { MAX_TOKENS } from './constants';
import { getSystemPrompt } from './prompts';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, getModelList, MODEL_REGEX, PROVIDER_REGEX } from '~/utils/constants';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | { type: string; text?: string }[];
  toolInvocations?: ToolResult<string, unknown, unknown>[];
  model?: string;
}

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

function extractPropertiesFromMessage(message: Message): {
  model: string;
  provider: string;
  content: string | { type: string; text?: string }[];
} {
  const textContent = Array.isArray(message.content)
    ? message.content.find((item) => item.type === 'text')?.text || ''
    : message.content;

  const modelMatch = typeof textContent === 'string' ? textContent.match(MODEL_REGEX) : null;
  const providerMatch = typeof textContent === 'string' ? textContent.match(PROVIDER_REGEX) : null;

  const model = modelMatch ? modelMatch[1] : DEFAULT_MODEL;
  const provider = providerMatch ? providerMatch[1] : DEFAULT_PROVIDER.name;

  const cleanedContent = Array.isArray(message.content)
    ? message.content.map((item) => {
        if (item.type === 'text') {
          return {
            type: 'text',
            text: item.text?.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, ''),
          };
        }

        return item; // Preserve image_url and other types as is
      })
    : typeof textContent === 'string'
      ? textContent.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '')
      : '';

  return { model, provider, content: cleanedContent };
}

export async function streamText(
  messages: Messages,
  env: Env,
  options?: StreamingOptions,
  apiKeys?: Record<string, string>,
) {
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  const MODEL_LIST = await getModelList(apiKeys || {});
  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);

      if (MODEL_LIST.find((m) => m.name === model)) {
        currentModel = model;
      }

      currentProvider = provider;

      return { ...message, content };
    }

    return message;
  });

  const modelDetails = MODEL_LIST.find((m) => m.name === currentModel);

  const dynamicMaxTokens = modelDetails && modelDetails.maxTokenAllowed ? modelDetails.maxTokenAllowed : MAX_TOKENS;

  // Manually convert messages to the format expected by the AI SDK
  const coreMessages = processedMessages.map((msg) => ({
    role: msg.role,
    content: Array.isArray(msg.content) ? msg.content.map((item) => item.text || '').join(' ') : msg.content,
  }));

  return _streamText({
    model: getModel(currentProvider, currentModel, env, apiKeys) as any,
    system: getSystemPrompt(),
    maxTokens: dynamicMaxTokens,
    messages: coreMessages,
    ...options,
  });
}
