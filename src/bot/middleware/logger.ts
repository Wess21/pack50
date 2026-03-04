import type { MyContext } from '../../types/context.js';
import { logger } from '../../utils/logger.js';
import type { NextFunction } from 'grammy';

/**
 * Logging middleware for bot updates
 * Records update details for debugging and analytics
 */
export async function loggerMiddleware(ctx: MyContext, next: NextFunction): Promise<void> {
  const updateId = ctx.update.update_id;
  const from = ctx.from;
  const chatId = ctx.chat?.id;

  // Extract message text (truncate long messages)
  const messageText = ctx.message?.text || ctx.callbackQuery?.data || 'no text';
  const truncatedText = messageText.length > 100 ? `${messageText.substring(0, 100)}...` : messageText;

  logger.info('Incoming update', {
    updateId,
    from: from ? { id: from.id, username: from.username, firstName: from.first_name } : undefined,
    chatId,
    messageText: truncatedText,
    updateType: ctx.update.message ? 'message' : ctx.update.callback_query ? 'callback_query' : 'other',
  });

  // Call next middleware
  await next();
}
