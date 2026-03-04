import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Define environment variable schema
const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  ENCRYPTION_KEY: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  DEFAULT_ADMIN_PASSWORD: z.string().default('changeme'),
});

// Validate environment variables
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('Environment validation failed:');
  console.error(parseResult.error.format());
  throw new Error('Invalid environment configuration. Please check your .env file.');
}

// Export validated environment configuration
export const env = parseResult.data;
