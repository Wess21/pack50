import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface LLMRequest {
  messages: Anthropic.MessageParam[];
  systemPrompt: string;
  maxTokens?: number;
}

/**
 * LLM Service for Claude API integration
 * Handles streaming responses and comprehensive error handling
 */
export class LLMService {
  private client: Anthropic;

  constructor() {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required for LLM service');
    }

    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      maxRetries: 2  // Auto-retry 408, 429, 5xx errors
    });

    logger.info('LLMService initialized', {
      model: 'claude-sonnet-4-5-20250929'
    });
  }

  /**
   * Generate AI response using Claude API with streaming
   * @param request - LLM request with messages, system prompt, and token limit
   * @returns Generated text response
   */
  async generateResponse(request: LLMRequest): Promise<string> {
    const { messages, systemPrompt, maxTokens = 1024 } = request;

    logger.debug('Generating LLM response', {
      messageCount: messages.length,
      maxTokens
    });

    try {
      // Use streaming for responses to avoid timeout on long responses
      const stream = this.client.messages.stream({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages
      });

      // Wait for final message
      const message = await stream.finalMessage();

      // Extract text from response
      const responseText = message.content[0]?.type === 'text'
        ? message.content[0].text
        : '';

      // Log token usage for monitoring
      logger.info('LLM response generated', {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        responseLength: responseText.length
      });

      return responseText;

    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Handle Claude API errors with user-friendly Russian messages
   * @param error - Error from Anthropic SDK
   * @returns Error with appropriate user-facing message
   */
  private handleError(error: unknown): Error {
    if (error instanceof Anthropic.APIError) {
      logger.error('LLM API error', {
        status: error.status,
        type: error.name,
        message: error.message
      });

      // Provide specific error messages based on status code
      switch (error.status) {
        case 400:
          return new Error('Извините, ваш запрос не может быть обработан. Попробуйте переформулировать.');
        case 401:
          return new Error('Ошибка конфигурации AI. Пожалуйста, свяжитесь с администратором.');
        case 429:
          return new Error('Сейчас высокая нагрузка на AI. Пожалуйста, попробуйте через минуту.');
        case 500:
        case 529:
          return new Error('AI временно недоступен. Пожалуйста, попробуйте позже или обратитесь к оператору.');
        default:
          return new Error('Произошла ошибка при генерации ответа. Пожалуйста, попробуйте снова.');
      }
    }

    // Generic error handling for non-API errors
    logger.error('Unexpected error in LLM service', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return new Error('Произошла ошибка при генерации ответа. Пожалуйста, попробуйте снова.');
  }
}
