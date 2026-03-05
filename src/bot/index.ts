import { Bot } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { MyContext } from '../types/context.js';
import { sessionMiddleware } from './middleware/session.js';
import { loggerMiddleware } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerCommands } from './commands.js';
import { leadCollectionFlow } from './conversations/lead-collection.js';
import { handleMessage } from './handlers/message-handler.js';
import { logger } from '../utils/logger.js';
import { db } from '../db/client.js';
import { decryptApiKey } from '../utils/encryption.js';

let botInstance: Bot<MyContext> | null = null;
let isBotRunning = false;

async function getBotToken(): Promise<string | null> {
  try {
    const result = await db.query('SELECT bot_token_encrypted, bot_token_iv FROM bot_config WHERE id = 1');
    if (result.rows.length === 0) return null;

    const { bot_token_encrypted, bot_token_iv } = result.rows[0];
    if (!bot_token_encrypted || !bot_token_iv) return null;

    return decryptApiKey(bot_token_encrypted, bot_token_iv);
  } catch (error) {
    logger.error('Failed to retrieve bot token from DB', { error });
    return null;
  }
}

function createBot(token: string): Bot<MyContext> {
  const newBot = new Bot<MyContext>(token);

  newBot.use(loggerMiddleware);
  newBot.use(sessionMiddleware);
  newBot.use(conversations());
  newBot.use(createConversation(leadCollectionFlow));
  registerCommands(newBot);
  newBot.on('message:text', handleMessage);
  newBot.catch(errorHandler);

  return newBot;
}

export async function reloadBot(): Promise<void> {
  logger.info('Reloading bot with new token...');

  if (isBotRunning && botInstance) {
    await botInstance.stop();
    isBotRunning = false;
    botInstance = null;
  }

  const token = await getBotToken();
  if (!token) {
    logger.warn('No bot token found in database. Bot is currently disabled.');
    return;
  }

  try {
    botInstance = createBot(token);
    botInstance.start({
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} started successfully`);
      },
    }).catch(err => {
      logger.error('Bot polling error', { error: err.message || String(err) });
    });
    isBotRunning = true;
  } catch (error) {
    logger.error('Failed to start bot', { error });
    botInstance = null;
    isBotRunning = false;
  }
}

/**
 * Start the bot with long polling for development
 */
export async function startBot(): Promise<void> {
  try {
    logger.info('Starting bot with long polling...');
    await reloadBot();
  } catch (error) {
    logger.error('Failed to start bot initial sequence', { error });
  }
}

/**
 * Stop the bot gracefully
 */
export async function stopBot(): Promise<void> {
  if (isBotRunning && botInstance) {
    logger.info('Stopping bot...');
    await botInstance.stop();
    isBotRunning = false;
    botInstance = null;
    logger.info('Bot stopped');
  } else {
    logger.info('Bot is already stopped or was not running.');
  }
}

// Ensure getter is available for cases we just need to send a message (like webhook notifications)
export function getBotInstance(): Bot<MyContext> | null {
  return botInstance;
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
