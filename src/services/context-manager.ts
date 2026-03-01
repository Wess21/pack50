import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

export interface ContextBudget {
  systemPrompt: number;      // Fixed: ~800 tokens
  ragContext: number;         // Variable: 3000-6000 tokens
  conversationHistory: number; // Variable: 2000-4000 tokens
  maxOutput: number;          // Fixed: 1024 tokens
  total: number;              // Total allocated tokens
}

/**
 * Context Manager for dynamic token budget allocation
 * Ensures context stays under 80% of Claude's context window
 */
export class ContextManager {
  private readonly MODEL_CONTEXT_LIMIT = 200000; // Claude Sonnet 3.5+
  private readonly SAFE_USAGE_PERCENT = 0.80;

  /**
   * Calculate safe token budget allocation between system prompt, RAG context, and conversation history
   * Priority: System prompt (fixed) > Recent history > RAG context
   *
   * @param ragChunks - Number of RAG chunks to include
   * @param conversationTurns - Number of conversation turns in history
   * @returns Token budget allocation for each component
   */
  calculateBudget(
    ragChunks: number,
    conversationTurns: number
  ): ContextBudget {
    const maxSafeTokens = this.MODEL_CONTEXT_LIMIT * this.SAFE_USAGE_PERCENT;

    // Fixed allocations
    const systemPrompt = 800;
    const maxOutput = 1024;

    // Available budget for dynamic context (RAG + conversation history)
    const availableForContext = maxSafeTokens - systemPrompt - maxOutput;

    // Dynamic split based on conversation depth
    // For conversational queries (>3 turns): 50/50 split
    // For simple queries (≤3 turns): 70/30 split (prioritize RAG context)
    const isConversational = conversationTurns > 3;
    const ragRatio = isConversational ? 0.5 : 0.7;
    const historyRatio = 1 - ragRatio;

    const ragContext = Math.floor(availableForContext * ragRatio);
    const conversationHistory = Math.floor(availableForContext * historyRatio);

    const budget: ContextBudget = {
      systemPrompt,
      ragContext,
      conversationHistory,
      maxOutput,
      total: systemPrompt + ragContext + conversationHistory + maxOutput
    };

    logger.debug('Calculated context budget', {
      ragChunks,
      conversationTurns,
      isConversational,
      budget
    });

    return budget;
  }

  /**
   * Truncate conversation history to fit within token budget
   * Keeps most recent messages and preserves user/assistant alternation
   *
   * @param messages - Full conversation history
   * @param maxTokenBudget - Maximum tokens allowed for history
   * @returns Truncated message array
   */
  truncateHistory(
    messages: Anthropic.MessageParam[],
    maxTokenBudget: number
  ): Anthropic.MessageParam[] {
    // Rough estimate: 1 token ≈ 4 characters
    const maxChars = maxTokenBudget * 4;

    let totalChars = 0;
    const result: Anthropic.MessageParam[] = [];

    // Iterate from most recent to oldest (reverse)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      // Extract text content from message
      const content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
        ? msg.content
            .map(c => c.type === 'text' ? c.text : '')
            .join('')
        : '';

      const contentLength = content.length;

      // Check if adding this message exceeds budget
      if (totalChars + contentLength > maxChars) {
        logger.debug('Truncating conversation history', {
          originalMessages: messages.length,
          keptMessages: result.length,
          totalChars,
          maxChars
        });
        break;
      }

      // Add message to result (at beginning since we're iterating backwards)
      result.unshift(msg);
      totalChars += contentLength;
    }

    // Ensure we have at least one message if possible
    if (result.length === 0 && messages.length > 0) {
      // Take the most recent message even if it exceeds budget
      result.push(messages[messages.length - 1]);
      logger.warn('History truncation: no messages fit budget, keeping most recent');
    }

    return result;
  }

  /**
   * Estimate token count from text (rough approximation)
   * 1 token ≈ 4 characters for English/Russian text
   *
   * @param text - Text to estimate
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
