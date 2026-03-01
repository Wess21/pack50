import { MyContext } from '../../types/context.js';
import { searchDocuments, formatCitations, extractContext } from '../../services/retrieval.js';
import { logger } from '../../utils/logger.js';
import { LLMService } from '../../services/llm.js';
import { ContextManager } from '../../services/context-manager.js';
import { WebhookService } from '../../services/webhook.js';
import { buildSystemPrompt } from '../../prompts/system-prompts.js';
import { buildPrompt } from '../../prompts/prompt-builder.js';
import { env } from '../../config/env.js';
import type Anthropic from '@anthropic-ai/sdk';

// Initialize services
const llmService = new LLMService();
const contextManager = new ContextManager();
const webhookService = new WebhookService(env.WEBHOOK_URL || '');

/**
 * Handle non-conversation messages with RAG retrieval
 * Called when user sends message outside of active conversation flow
 */
export async function handleMessage(ctx: MyContext) {
  const messageText = ctx.message?.text;

  if (!messageText) {
    return;  // Ignore non-text messages
  }

  // Skip if user is in active conversation flow
  if (ctx.session.conversationState !== 'idle') {
    return;  // Let conversation handler process
  }

  try {
    logger.info('Processing RAG query', {
      userId: ctx.from?.id,
      query: messageText.substring(0, 100)  // Log first 100 chars
    });

    // Send typing indicator
    await ctx.replyWithChatAction('typing');

    // Search relevant documents
    const searchResults = await searchDocuments(messageText, {
      k: 5,
      minSimilarity: 0.3
    });

    // Handle no results case
    if (searchResults.length === 0) {
      await ctx.reply(
        'К сожалению, я не нашел информации по вашему вопросу в загруженных документах.\n\n' +
        'Попробуйте переформулировать вопрос или обратитесь к администратору для загрузки дополнительных материалов.'
      );
      return;
    }

    // Phase 3: LLM integration with RAG context
    const ragContext = extractContext(searchResults);
    const citations = formatCitations(searchResults);

    // Load conversation history from session
    const sessionHistory = ctx.session.messageHistory || [];

    // Convert session history to Anthropic message format
    const conversationHistory: Anthropic.MessageParam[] = sessionHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Calculate token budget
    const budget = contextManager.calculateBudget(
      searchResults.length,
      sessionHistory.length
    );

    // Truncate history to fit budget
    const truncatedHistory = contextManager.truncateHistory(
      conversationHistory,
      budget.conversationHistory
    );

    // Truncate RAG context (rough estimate: 1 token ≈ 4 chars)
    const truncatedRagContext = ragContext.substring(0, budget.ragContext * 4);

    // Build prompt with RAG context + history
    const messages = buildPrompt(truncatedRagContext, truncatedHistory, messageText);

    // Generate AI response
    let response: string;
    try {
      response = await llmService.generateResponse({
        messages,
        systemPrompt: buildSystemPrompt('consultant'),
        maxTokens: budget.maxOutput
      });

      // Optionally append citations for transparency
      if (citations) {
        response += `\n\n${citations}`;
      }
    } catch (error) {
      logger.error('LLM generation failed, falling back to RAG only', {
        userId: ctx.from?.id,
        error: error instanceof Error ? error.message : String(error)
      });

      // Fallback to Phase 2 behavior (RAG without LLM)
      response = `Найденная информация:\n\n${ragContext}\n\n---\n\n${citations}`;
    }

    // Send response
    await ctx.reply(response.substring(0, 4000));  // Telegram limit

    // Update conversation history (last 10 turns only)
    const updatedHistory = [
      ...sessionHistory,
      {
        role: 'user' as const,
        content: messageText,
        timestamp: new Date()
      },
      {
        role: 'assistant' as const,
        content: response,
        timestamp: new Date()
      }
    ].slice(-20);  // Keep last 10 turns (20 messages)

    ctx.session.messageHistory = updatedHistory;

    // Check if lead data is complete and send webhook
    const leadData = ctx.session.leadData;
    if (leadData.name && leadData.email && leadData.phone) {
      try {
        await webhookService.send({
          event_type: 'lead_collected',
          timestamp: new Date().toISOString(),
          webhook_id: crypto.randomUUID(),
          user_id: String(ctx.from?.id || 0),
          collected_data: {
            name: leadData.name,
            email: leadData.email,
            phone: leadData.phone,
            additional_info: leadData.additional_info
          }
        });
        logger.info('Webhook sent for completed lead', { userId: ctx.from?.id });
      } catch (webhookError) {
        logger.warn('Webhook delivery failed (non-critical)', {
          userId: ctx.from?.id,
          error: webhookError instanceof Error ? webhookError.message : String(webhookError)
        });
      }
    }

    logger.info('RAG query completed', {
      userId: ctx.from?.id,
      resultsFound: searchResults.length,
      avgSimilarity: searchResults.reduce((sum, r) => sum + r.similarity, 0) / searchResults.length
    });
  } catch (error: any) {
    logger.error('RAG query failed', {
      userId: ctx.from?.id,
      error: error.message
    });

    await ctx.reply(
      'Произошла ошибка при поиске информации. Пожалуйста, попробуйте позже или обратитесь в поддержку.'
    );
  }
}
