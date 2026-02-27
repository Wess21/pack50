import { session } from 'grammy';
import { RedisAdapter } from '@grammyjs/storage-redis';
import Redis from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { MyContext } from '../../types/context.js';
import type { SessionData } from '../../types/session.js';

// Parse Redis URL
const redisUrl = new URL(env.REDIS_URL);
const redisHost = redisUrl.hostname;
const redisPort = parseInt(redisUrl.port || '6379', 10);
const redisPassword = redisUrl.password || undefined;

// Create Redis client
const redis = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPassword,
  lazyConnect: true, // Don't connect until first use
  retryStrategy: (times) => {
    // Exponential backoff: 50ms, 100ms, 200ms, ..., max 2s
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Handle Redis connection events
redis.on('connect', () => {
  logger.info('Redis connected for session storage');
});

redis.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

// Create Redis storage adapter with SessionData type
// Note: We pass ttl directly to RedisAdapter for 24-hour expiration
const storage = new RedisAdapter<SessionData>({
  instance: redis,
  ttl: 24 * 60 * 60, // 24 hours in seconds (CONV-07 requirement)
});

/**
 * Session middleware with Redis-backed storage
 * - Each chat gets isolated session (keyed by chat ID)
 * - Sessions expire after 24 hours of inactivity (via Redis TTL)
 * - Initial session state is "idle" with empty lead data
 */
export const sessionMiddleware = session<SessionData, MyContext>({
  initial: (): SessionData => ({
    conversationState: 'idle',
    leadData: {},
    messageHistory: [],
    lastActivityAt: new Date(),
  }),
  storage,
  getSessionKey: (ctx) => {
    // Use chat ID as session key (supports both private and group chats)
    // Each chat gets isolated session data
    return ctx.chat?.id.toString();
  },
});
