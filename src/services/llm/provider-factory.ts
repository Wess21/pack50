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
 * Create LLM provider based on active provider in database
 * Falls back to bot_config and environment variables if no active provider found
 */
export async function createLLMProvider(): Promise<LLMProvider> {
  try {
    // Try to get active provider from new llm_providers table
    const providerResult = await db.query(
      `SELECT provider_type, api_key_encrypted, encryption_iv, api_base_url, model_name
       FROM llm_providers
       WHERE is_active = TRUE
       LIMIT 1`
    );

    if (providerResult.rows.length > 0) {
      const provider = providerResult.rows[0];
      const apiKey = decryptApiKey(provider.api_key_encrypted, provider.encryption_iv);

      logger.info('Creating LLM provider from llm_providers table', {
        providerType: provider.provider_type,
        hasBaseUrl: !!provider.api_base_url,
        modelName: provider.model_name,
      });

      if (provider.provider_type === 'anthropic') {
        if (provider.api_base_url) {
          logger.info('Using OpenAI-compatible client for custom Anthropic endpoint (llm_providers)', { baseURL: provider.api_base_url });
          return new OpenAIProvider(apiKey, {
            baseURL: provider.api_base_url,
            model: provider.model_name || 'anthropic/claude-3-5-sonnet-20241022'
          });
        }
        return new AnthropicProvider(
          apiKey,
          {
            baseURL: undefined,
            model: provider.model_name || 'claude-sonnet-4-5-20250929'
          }
        );
      } else {
        return new OpenAIProvider(apiKey, {
          baseURL: provider.api_base_url || undefined,
          model: provider.model_name || 'gpt-4o',
        });
      }
    }

    // Fallback to old bot_config table
    logger.warn('No active provider found in llm_providers, falling back to bot_config');

    const result = await db.query(
      `SELECT active_model, anthropic_api_key_encrypted, openai_api_key_encrypted, encryption_iv, api_base_url, llm_model_name
       FROM bot_config WHERE id = 1`
    );

    if (result.rows.length === 0) {
      throw new Error('Bot configuration not found in database');
    }

    const config = result.rows[0];
    const activeModel = (config.active_model || 'claude-sonnet-4-5') as ModelName;
    const providerType = MODEL_TO_PROVIDER_MAP[activeModel];

    logger.info('Creating LLM provider from bot_config', { model: activeModel, provider: providerType });

    if (providerType === 'anthropic') {
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

      if (config.api_base_url) {
        logger.info('Using OpenAI-compatible client for custom Anthropic endpoint (bot_config)', { baseURL: config.api_base_url });
        return new OpenAIProvider(apiKey, {
          baseURL: config.api_base_url,
          model: config.llm_model_name || `anthropic/${activeModel}`
        });
      }

      const options: { baseURL?: string; model?: string } = {};
      options.model = config.llm_model_name || MODEL_IDS[activeModel];

      return new AnthropicProvider(apiKey, options);
    } else {
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

      const options: { baseURL?: string; model?: string } = {};

      if (config.api_base_url) {
        options.baseURL = config.api_base_url;
        logger.info('Using custom API base URL', { baseURL: config.api_base_url });
      }

      if (config.llm_model_name) {
        options.model = config.llm_model_name;
        logger.info('Using custom model name', { model: config.llm_model_name });
      } else {
        options.model = MODEL_IDS[activeModel];
      }

      return new OpenAIProvider(apiKey, options);
    }
  } catch (error: any) {
    logger.error('Failed to create LLM provider', { error: error.message });
    throw error;
  }
}
