import { env } from './config/env.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { startBot, stopBot } from './bot/index.js';

/**
 * Main application entry point
 */
async function main() {
  try {
    console.log('=== Pack50 Bot Starting ===');
    console.log(`Environment: ${env.NODE_ENV}`);
    console.log(`Port: ${env.PORT}`);

    // Initialize database schema
    console.log('Initializing database...');
    await initDatabase();

    // Start Telegram bot
    console.log('Starting Telegram bot...');
    await startBot();

    console.log('=== Pack50 Bot Ready ===');
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');
  try {
    await stopBot();
    await closeDatabase();
    console.log('Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start application
main();
