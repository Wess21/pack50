import express, { Request, Response, NextFunction } from 'express';
import { webhookCallback } from 'grammy';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Bot } from 'grammy';
import type { MyContext } from '../types/context.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Create Express app with webhook endpoint
 * Includes security middleware and secret token validation
 */
export function createWebhookServer(bot: Bot<MyContext>): express.Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(express.json());

  // Rate limiting for webhook endpoint (100 requests per minute)
  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Webhook secret token validation middleware
  const validateWebhookSecret = (req: Request, res: Response, next: NextFunction): void => {
    if (!env.WEBHOOK_SECRET) {
      // Development mode (no webhook secret configured)
      logger.warn('WEBHOOK_SECRET not set, skipping token validation (insecure!)');
      return next();
    }

    const token = req.header('X-Telegram-Bot-Api-Secret-Token');
    if (token !== env.WEBHOOK_SECRET) {
      logger.error('Invalid webhook secret token', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(403).send('Forbidden');
      return;
    }

    next();
  };

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Webhook endpoint with security middleware
  app.post(
    '/webhook',
    webhookLimiter,
    validateWebhookSecret,
    webhookCallback(bot, 'express')
  );

  return app;
}

/**
 * Start bot in webhook mode
 * Sets up webhook with Telegram and starts Express server
 */
export async function startWebhook(bot: Bot<MyContext>): Promise<express.Application> {
  if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_URL and WEBHOOK_SECRET must be set for webhook mode');
  }

  const webhookUrl = `${env.WEBHOOK_URL}/webhook`;

  logger.info('Setting up webhook', { url: webhookUrl });

  // Set webhook with Telegram
  await bot.api.setWebhook(webhookUrl, {
    secret_token: env.WEBHOOK_SECRET,
    drop_pending_updates: true, // Ignore updates accumulated during downtime
  });

  logger.info('Webhook configured successfully', { url: webhookUrl });

  // Create Express server
  const app = createWebhookServer(bot);

  // Start listening
  const server = app.listen(env.PORT, () => {
    logger.info(`Webhook server listening on port ${env.PORT}`);
  });

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down webhook server...');

    // Stop accepting new requests
    server.close((err) => {
      if (err) {
        logger.error('Error closing server', { error: err.message });
      } else {
        logger.info('Server closed');
      }
    });

    // Delete webhook
    try {
      await bot.api.deleteWebhook();
      logger.info('Webhook deleted');
    } catch (error) {
      logger.error('Failed to delete webhook', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  process.once('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  return app;
}
