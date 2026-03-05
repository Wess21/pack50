import { env } from './config/env.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { startBot, stopBot } from './bot/index.js';
import { logger } from './utils/logger.js';
import { EmbeddingService } from './services/embedding.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import documentsRouter from './api/routes/documents.js';
import adminRouter from './api/routes/admin.js';
import providersRouter from './api/routes/providers.js';
import { seedAdminUser } from './db/seed-admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info('=== Pack50 Bot Starting ===');
    logger.info('Environment', {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
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

    // Start API server BEFORE bot.start() because bot.start() is blocking
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api/documents', documentsRouter);
    app.use('/api/admin', adminRouter);
    app.use('/api/providers', providersRouter);

    // Serve static files (admin panel)
    const publicPath = path.join(__dirname, '../public');
    app.use(express.static(publicPath));

    // Health check
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    const API_PORT = env.PORT || 3000;
    app.listen(API_PORT, () => {
      logger.info(`API server listening on port ${API_PORT}`);
    });

    logger.info('Starting bot in long polling mode (production/development)...');
    await startBot();
    logger.info('=== Pack50 Bot Ready (Long Polling Mode) ===');
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

// Register shutdown handlers
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start application
main();
