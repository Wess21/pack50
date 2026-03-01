import { env } from './config/env.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { bot, startBot, stopBot } from './bot/index.js';
import { startWebhook } from './bot/webhook.js';
import { logger } from './utils/logger.js';
import { EmbeddingService } from './services/embedding.js';
import express from 'express';
import cors from 'cors';
import documentsRouter from './api/routes/documents.js';
import adminRouter from './api/routes/admin.js';
import { seedAdminUser } from './db/seed-admin.js';

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

    // Seed default admin user (Phase 4)
    logger.info('Seeding admin user...');
    await seedAdminUser();

    // Preload embedding model
    logger.info('Preloading embedding model...');
    await EmbeddingService.preloadEmbeddingModel();
    logger.info('Embedding model preloaded');

    // Start bot in appropriate mode
    if (env.WEBHOOK_URL && env.WEBHOOK_SECRET) {
      // Production: use webhook (integrates with webhook Express app)
      logger.info('Starting bot in webhook mode...');
      const webhookApp = await startWebhook(bot);

      // Add document upload routes and admin routes to webhook app
      webhookApp.use(cors());
      webhookApp.use(express.json());
      webhookApp.use('/api/documents', documentsRouter);
      webhookApp.use('/api/admin', adminRouter);

      logger.info('=== Pack50 Bot Ready (Webhook Mode) ===');
    } else {
      // Development: use long polling + separate API server
      // IMPORTANT: Start API server BEFORE bot.start() because bot.start() is blocking
      const app = express();
      app.use(cors());
      app.use(express.json());
      app.use('/api/documents', documentsRouter);
      app.use('/api/admin', adminRouter);

      const API_PORT = env.PORT || 3000;
      app.listen(API_PORT, () => {
        logger.info(`API server listening on port ${API_PORT}`);
      });

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
