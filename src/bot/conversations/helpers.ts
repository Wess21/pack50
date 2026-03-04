import type { SessionData } from '../../types/session.js';
import { logger } from '../../utils/logger.js';
import { createLLMProvider } from '../../services/llm/provider-factory.js';

// Maximum messages to keep in active context
const MAX_CONTEXT_MESSAGES = 10;

/**
 * Context management result
 */
export interface ManagedContext {
  messages: SessionData['messageHistory'];
  summary?: string;
}

/**
 * Manage conversation context with sliding window and summarization
 *
 * Strategy:
 * - Keep last 10 messages in active context
 * - When history exceeds 10 messages, summarize older messages
 * - Summary prevents context overflow in long conversations
 *
 * @param session - Current session data
 * @returns Managed context with recent messages and optional summary
 */
export async function manageConversationContext(session: SessionData): Promise<ManagedContext> {
  const messageHistory = session.messageHistory;

  // If within limit, return all messages
  if (messageHistory.length <= MAX_CONTEXT_MESSAGES) {
    return { messages: messageHistory };
  }

  // Split into recent (last 10) and old messages
  const recentMessages = messageHistory.slice(-MAX_CONTEXT_MESSAGES);
  const oldMessages = messageHistory.slice(0, -MAX_CONTEXT_MESSAGES);

  // Generate or use existing summary
  let summary = session.conversationSummary;

  // Regenerate summary if we have many old messages without summary
  // or if old messages have accumulated significantly (20+)
  if (!summary || oldMessages.length > 20) {
    logger.debug('Generating conversation summary', {
      totalMessages: messageHistory.length,
      oldMessages: oldMessages.length,
    });

    // Try dynamic LLM summarization
    try {
      const llmProvider = await createLLMProvider();
      const formattedMessages = oldMessages
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join('\n');

      const response = await llmProvider.generateResponse({
        messages: [
          {
            role: 'user',
            content: `Summarize the key points and context from this conversation concisely (2-3 sentences):\n\n${formattedMessages}`,
          },
        ],
        systemPrompt: 'You are a concise summarizer.',
        maxTokens: 200,
      });

      summary = response.content.trim();
      logger.debug('Summary generated via dynamic LLM', { summary });
    } catch (error) {
      logger.warn('Failed to generate conversation summary via LLM', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to simple summary
    }

    // Fallback: simple message count summary (when no API key or LLM failed)
    if (!summary) {
      summary = `[Previous conversation with ${oldMessages.length} messages]`;
      logger.debug('Using simple summary (no LLM)', { summary });
    }
  }

  return {
    messages: recentMessages,
    summary,
  };
}

/**
 * Check if lead data is complete (has all required fields)
 *
 * @param leadData - Partial lead data
 * @returns True if name, email, and phone are present
 */
export function isLeadComplete(leadData: Partial<SessionData['leadData']>): boolean {
  // Only phone is mandatory now based on user requirements
  return Boolean(leadData.phone);
}
