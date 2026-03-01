import { db } from '../../db/client.js';
import { decryptApiKey } from '../../utils/encryption.js';
import { LLMProvider, ModelName } from './types.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';

/**
 * Map model names to provider types
 */
const MODEL_TO_PROVIDER_MAP: Record<ModelName, 'anthropic' | 'openai'> = {
  'claude-sonnet-4-5': 'anthropic',
  'claude-sonnet-3-5': 'anthropic',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
};

/**
 * Map model names to actual API model IDs
 */
const MODEL_IDS: Record<ModelName, string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-3-5': 'claude-sonnet-3-5-20241022',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
};

/**
 * Create LLM provider based on database configuration
 * Falls back to environment variables if database keys not configured
 */
export async function createLLMProvider(): Promise<LLMProvider> {
  try {
    // Fetch configuration from database
    const result = await db.query(
      `SELECT active_model, anthropic_api_key_encrypted, openai_api_key_encrypted, encryption_iv
       FROM bot_config WHERE id = 1`
    );

    if (result.rows.length === 0) {
      throw new Error('Bot configuration not found in database');
    }

    const config = result.rows[0];
    const activeModel = (config.active_model || 'claude-sonnet-4-5') as ModelName;
    const providerType = MODEL_TO_PROVIDER_MAP[activeModel];

    logger.info('Creating LLM provider', { model: activeModel, provider: providerType });

    if (providerType === 'anthropic') {
      // Try database key first, fallback to env
      let apiKey: string;

      if (config.anthropic_api_key_encrypted && config.encryption_iv) {
        apiKey = decryptApiKey(
          config.anthropic_api_key_encrypted,
          config.encryption_iv
        );
        logger.info('Using Anthropic API key from database');
      } else if (env.ANTHROPIC_API_KEY) {
        apiKey = env.ANTHROPIC_API_KEY;
        logger.warn('Using Anthropic API key from .env (not in database)');
      } else {
        throw new Error('No Anthropic API key configured');
      }

      return new AnthropicProvider(apiKey, MODEL_IDS[activeModel]);
    } else {
      // OpenAI
      let apiKey: string;

      if (config.openai_api_key_encrypted && config.encryption_iv) {
        apiKey = decryptApiKey(config.openai_api_key_encrypted, config.encryption_iv);
        logger.info('Using OpenAI API key from database');
      } else if (env.OPENAI_API_KEY) {
        apiKey = env.OPENAI_API_KEY;
        logger.warn('Using OpenAI API key from .env (not in database)');
      } else {
        throw new Error('No OpenAI API key configured');
      }

      return new OpenAIProvider(apiKey, MODEL_IDS[activeModel]);
    }
  } catch (error: any) {
    logger.error('Failed to create LLM provider', { error: error.message });
    throw error;
  }
}
