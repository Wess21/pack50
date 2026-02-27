import type { Bot } from 'grammy';
import type { MyContext } from '../types/context.js';
import { logger } from '../utils/logger.js';

/**
 * /start command handler
 * Starts lead collection conversation flow
 */
async function startCommand(ctx: MyContext): Promise<void> {
  logger.info('Start command received', {
    userId: ctx.from?.id,
    username: ctx.from?.username,
    chatId: ctx.chat?.id,
  });

  // Reset session to idle state
  ctx.session.conversationState = 'idle';
  ctx.session.leadData = {};
  ctx.session.messageHistory = [];
  ctx.session.lastActivityAt = new Date();

  // Enter lead collection conversation flow
  await ctx.conversation.enter('leadCollectionFlow');
}

/**
 * /help command handler
 * Shows available commands and bot capabilities
 */
async function helpCommand(ctx: MyContext): Promise<void> {
  logger.info('Help command received', {
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
  });

  const helpMessage = `
Available commands:

/start - Start a new conversation
/help - Show this help message
/cancel - Cancel the current conversation

I'll guide you through providing your information. Just send me a message and I'll help you!
  `.trim();

  await ctx.reply(helpMessage);
}

/**
 * /cancel command handler
 * Cancels active conversation and resets state
 */
async function cancelCommand(ctx: MyContext): Promise<void> {
  logger.info('Cancel command received', {
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    currentState: ctx.session.conversationState,
  });

  // Check if there's an active conversation
  if (ctx.session.conversationState !== 'idle') {
    // Reset to idle state
    ctx.session.conversationState = 'idle';
    ctx.session.leadData = {};
    ctx.session.messageHistory = [];
    ctx.session.lastActivityAt = new Date();

    await ctx.reply('Conversation cancelled. Use /start to begin again.');
  } else {
    await ctx.reply('No active conversation to cancel. Use /start to begin.');
  }
}

/**
 * Register all command handlers with the bot
 */
export function registerCommands(bot: Bot<MyContext>): void {
  bot.command('start', startCommand);
  bot.command('help', helpCommand);
  bot.command('cancel', cancelCommand);

  logger.info('Commands registered: /start, /help, /cancel');
}
