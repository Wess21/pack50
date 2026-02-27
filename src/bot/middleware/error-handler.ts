import { BotError, GrammyError, HttpError } from 'grammy';
import { logger } from '../../utils/logger.js';
import type { MyContext } from '../../types/context.js';

/**
 * Global error handler for bot
 * Catches all errors to prevent crashes and provides user feedback
 */
export async function errorHandler(err: BotError<MyContext>): Promise<void> {
  const ctx = err.ctx;
  const error = err.error;

  logger.error('Bot error occurred', {
    updateId: ctx.update.update_id,
    chatId: ctx.chat?.id,
    userId: ctx.from?.id,
    errorName: error instanceof Error ? error.name : 'Unknown',
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  // Log specific error types with additional context
  if (error instanceof GrammyError) {
    logger.error('Telegram API error', {
      description: error.description,
      method: error.method,
      parameters: error.parameters,
    });
  } else if (error instanceof HttpError) {
    logger.error('HTTP/Network error', {
      statusCode: (error as any).status,
    });
  } else {
    logger.error('Unknown error', {
      type: typeof error,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Send user-friendly error message
  try {
    await ctx.reply(
      'Sorry, something went wrong. Please try again or use /help for assistance.',
      { parse_mode: undefined } // Disable parse mode to avoid errors with special characters
    );
  } catch (replyError) {
    // If we can't send error message, just log it
    logger.error('Failed to send error message to user', {
      error: replyError instanceof Error ? replyError.message : String(replyError),
    });
  }
}
