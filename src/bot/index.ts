import { Bot } from 'grammy';
import { env } from '../config/env.js';

// Create bot instance with Telegram token
export const bot = new Bot(env.BOT_TOKEN);

// Basic command handlers
bot.command('start', async (ctx) => {
  await ctx.reply('Bot is running!');
});

// Global error handler
bot.catch((err) => {
  console.error('Bot error:', err);
});

/**
 * Start the bot with long polling for development
 */
export async function startBot(): Promise<void> {
  try {
    console.log('Starting bot with long polling...');

    // Start bot with long polling
    await bot.start({
      onStart: (botInfo) => {
        console.log(`Bot @${botInfo.username} started successfully`);
      },
    });
  } catch (error) {
    console.error('Failed to start bot:', error);
    throw error;
  }
}

/**
 * Stop the bot gracefully
 */
export async function stopBot(): Promise<void> {
  console.log('Stopping bot...');
  await bot.stop();
  console.log('Bot stopped');
}

// Graceful shutdown handlers
process.once('SIGINT', () => {
  console.log('SIGINT received, stopping bot...');
  stopBot().then(() => process.exit(0));
});

process.once('SIGTERM', () => {
  console.log('SIGTERM received, stopping bot...');
  stopBot().then(() => process.exit(0));
});
