import { Bot } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { env } from '../config/env.js';
import type { MyContext } from '../types/context.js';
import { sessionMiddleware } from './middleware/session.js';
import { loggerMiddleware } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerCommands } from './commands.js';
import { leadCollectionFlow } from './conversations/lead-collection.js';
import { handleMessage } from './handlers/message-handler.js';
import { logger } from '../utils/logger.js';

// Create bot instance with custom context type
export const bot = new Bot<MyContext>(env.BOT_TOKEN);

// Apply middleware in order (order matters!)
// 1. Logger - log all updates first
bot.use(loggerMiddleware);

// 2. Session - attach session to context (MUST be before conversations)
bot.use(sessionMiddleware);

// 3. Commands - register command handlers (MUST be before conversations to allow /start and /cancel to kill active sessions)
registerCommands(bot);

// 4. Conversations plugin - enable multi-turn dialogues
bot.use(conversations());

// 5. Register lead collection conversation
bot.use(createConversation(leadCollectionFlow));

// 6. Message handler - RAG retrieval for non-conversation messages
bot.on('message:text', handleMessage);

// 7. Global error handler - catch all errors (prevents crashes)
bot.catch(errorHandler);

/**
 * Start the bot with long polling for development
 */
export async function startBot(): Promise<void> {
  try {
    logger.info('Starting bot with long polling...');

    // Start bot with long polling
    await bot.start({
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} started successfully`);
      },
    });
  } catch (error) {
    logger.error('Failed to start bot', { error });
    throw error;
  }
}

/**
 * Stop the bot gracefully
 */
export async function stopBot(): Promise<void> {
  logger.info('Stopping bot...');
  await bot.stop();
  logger.info('Bot stopped');
}

// Graceful shutdown handlers
process.once('SIGINT', () => {
  logger.info('SIGINT received, stopping bot...');
  stopBot().then(() => process.exit(0));
});

process.once('SIGTERM', () => {
  logger.info('SIGTERM received, stopping bot...');
  stopBot().then(() => process.exit(0));
});
