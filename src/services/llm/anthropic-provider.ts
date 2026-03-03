import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMGenerateRequest, LLMGenerateResponse } from './types.js';
import { logger } from '../../utils/logger.js';

/**
 * Anthropic Claude API provider implementation
 */
export class AnthropicProvider implements LLMProvider {
  public name = 'Anthropic';
  private client: Anthropic;
  private modelName: string;

  constructor(apiKey: string, options?: { baseURL?: string; model?: string }) {
    this.client = new Anthropic({
      apiKey,
      baseURL: options?.baseURL,
      maxRetries: 2, // Auto-retry 408, 429, 5xx errors
    });
    this.modelName = options?.model || 'claude-sonnet-4-5-20250929';

    logger.info('AnthropicProvider initialized', { model: this.modelName, hasBaseURL: !!options?.baseURL });
  }

  async generateResponse(request: LLMGenerateRequest): Promise<LLMGenerateResponse> {
    const { messages, systemPrompt, maxTokens, temperature = 0.7 } = request;

    // Convert generic messages to Anthropic format
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((msg) => ({
      role: msg.role === 'system' ? 'user' : msg.role, // Anthropic doesn't support system role in messages
      content: msg.content,
    }));

    try {
      // Use streaming to avoid timeout on long responses
      const stream = this.client.messages.stream({
        model: this.modelName,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: anthropicMessages,
      });

      // Wait for final message
      const message = await stream.finalMessage();

      // Extract text from response
      const content =
        message.content[0]?.type === 'text' ? message.content[0].text : '';

      logger.info('Anthropic API response', {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        totalTokens:
          message.usage.input_tokens + message.usage.output_tokens,
      });

      return {
        content,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    } catch (error: any) {
      logger.error('Anthropic API error', {
        error: error.message,
        status: error.status,
      });

      // Convert to user-friendly Russian messages
      if (error.status === 401) {
        throw new Error('Неверный API ключ Anthropic');
      } else if (error.status === 429) {
        throw new Error('Превышен лимит запросов к Anthropic API');
      } else if (error.status === 500 || error.status === 529) {
        throw new Error('Ошибка сервера Anthropic, попробуйте позже');
      } else {
        throw new Error('Ошибка генерации ответа от Anthropic');
      }
    }
  }

  /**
   * Test API connection with minimal request
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.modelName,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Test' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
