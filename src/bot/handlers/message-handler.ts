import { MyContext } from '../../types/context.js';
import { searchDocuments, formatCitations, extractContext } from '../../services/retrieval.js';
import { logger } from '../../utils/logger.js';

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

    // For Phase 2, return context + citations without LLM
    // LLM integration happens in Phase 3
    const context = extractContext(searchResults);
    const citations = formatCitations(searchResults);

    // Format response
    const response = `Найденная информация:\n\n${context}\n\n---\n\n${citations}`;

    // Send response (split if too long)
    if (response.length > 4000) {
      // Telegram message limit is 4096 chars
      const contextPart = `Найденная информация:\n\n${context}`;
      await ctx.reply(contextPart.substring(0, 3900) + '\n\n[...обрезано...]');
      await ctx.reply(citations);
    } else {
      await ctx.reply(response);
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
