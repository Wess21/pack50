import OpenAI from 'openai';
import { LLMProvider, LLMGenerateRequest, LLMGenerateResponse } from './types.js';
import { logger } from '../../utils/logger.js';

/**
 * OpenAI GPT API provider implementation
 */
export class OpenAIProvider implements LLMProvider {
  public name = 'OpenAI';
  private client: OpenAI;
  private modelName: string;

  constructor(apiKey: string, options?: { baseURL?: string; model?: string }) {
    this.client = new OpenAI({
      apiKey,
      baseURL: options?.baseURL,
      maxRetries: 2,
    });
    this.modelName = options?.model || 'gpt-4o';

    logger.info('OpenAIProvider initialized', {
      model: this.modelName,
      baseURL: options?.baseURL || 'default'
    });
  }

  async generateResponse(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    const { messages, systemPrompt, maxTokens, temperature = 0.7 } = request;

    // Convert to OpenAI format
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt });
    }

    // Add conversation messages
    openaiMessages.push(
      ...messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }))
    );

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: openaiMessages,
        max_tokens: maxTokens,
        temperature,
      });

      const content = response.choices[0]?.message?.content || '';

      logger.info('OpenAI API response', {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      });

      return {
        content,
        usage: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
        },
      };
    } catch (error: any) {
      logger.error('OpenAI API error', {
        error: error.message,
        status: error.status,
      });

      // Convert to user-friendly Russian messages
      if (error.status === 401) {
        throw new Error('Неверный API ключ OpenAI');
      } else if (error.status === 429) {
        throw new Error('Превышен лимит запросов к OpenAI API');
      } else if (error.status === 500 || error.status === 503) {
        throw new Error('Ошибка сервера OpenAI, попробуйте позже');
      } else {
        throw new Error('Ошибка генерации ответа от OpenAI');
      }
    }
  }

  /**
   * Test API connection with minimal request
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 10,
      });
      return true;
    } catch {
      return false;
    }
  }
}
