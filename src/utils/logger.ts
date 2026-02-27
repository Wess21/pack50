import winston from 'winston';
import { env } from '../config/env.js';

// Determine log level based on environment
const logLevel = env.NODE_ENV === 'production' ? 'info' : 'debug';

/**
 * Winston logger configuration
 * - Development: debug level with colorized console output
 * - Production: info level with JSON format for log aggregation
 */
export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    // Console transport with colorization for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(
          ({ timestamp, level, message, ...meta }) =>
            `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`
        )
      ),
    }),
  ],
});

// Log startup info
logger.info('Logger initialized', {
  level: logLevel,
  environment: env.NODE_ENV,
});
