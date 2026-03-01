import { env } from './config/env.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { bot, startBot, stopBot } from './bot/index.js';
import { startWebhook } from './bot/webhook.js';
import { logger } from './utils/logger.js';
import { EmbeddingService } from './services/embedding.js';

/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info('=== Pack50 Bot Starting ===');
    logger.info('Environment', {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      webhookMode: Boolean(env.WEBHOOK_URL && env.WEBHOOK_SECRET),
    });

    // Initialize database schema
    logger.info('Initializing database...');
    await initDatabase();

    // Preload embedding model
    logger.info('Preloading embedding model...');
    await EmbeddingService.preloadEmbeddingModel();
    logger.info('Embedding model preloaded');

    // Start bot in appropriate mode
    if (env.WEBHOOK_URL && env.WEBHOOK_SECRET) {
      // Production: use webhook
      logger.info('Starting bot in webhook mode...');
      await startWebhook(bot);
      logger.info('=== Pack50 Bot Ready (Webhook Mode) ===');
    } else {
      // Development: use long polling
      logger.info('Starting bot in long polling mode (development)...');
      await startBot();
      logger.info('=== Pack50 Bot Ready (Long Polling Mode) ===');
    }
  } catch (error) {
    logger.error('Failed to start application', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Graceful shutdown for long polling mode
async function shutdown() {
  logger.info('Shutting down gracefully...');
  try {
    await stopBot();
    await closeDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Only register shutdown handlers for long polling mode
// Webhook mode has its own handlers in webhook.ts
if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Start application
main();
