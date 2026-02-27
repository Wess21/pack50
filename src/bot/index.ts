import { Bot } from 'grammy';
import { env } from '../config/env.js';
import type { MyContext } from '../types/context.js';
import { sessionMiddleware } from './middleware/session.js';
import { loggerMiddleware } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerCommands } from './commands.js';
import { logger } from '../utils/logger.js';

// Create bot instance with custom context type
export const bot = new Bot<MyContext>(env.BOT_TOKEN);

// Apply middleware in order (order matters!)
// 1. Logger - log all updates first
bot.use(loggerMiddleware);

// 2. Session - attach session to context
bot.use(sessionMiddleware);

// 3. Commands - register command handlers
registerCommands(bot);

// 4. Test handler - verify session persistence across restarts
bot.on('message:text', async (ctx) => {
  // Skip if it's a command
  if (ctx.message.text.startsWith('/')) {
    return;
  }

  // Update last activity timestamp
  ctx.session.lastActivityAt = new Date();

  // Increment message counter for testing persistence
  const count = (ctx.session.messageCount || 0) + 1;
  ctx.session.messageCount = count;

  await ctx.reply(
    `Message ${count} received (session persists across restarts).\n\n` +
    `Current state: ${ctx.session.conversationState}\n` +
    `Use /start to begin a conversation.`
  );
});

// 5. Global error handler - catch all errors (prevents crashes)
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
