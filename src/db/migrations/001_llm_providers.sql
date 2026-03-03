-- Migration: Add LLM providers table for multi-provider management
-- This replaces the single provider fields in bot_config with a flexible multi-provider system

-- Create LLM providers table
CREATE TABLE IF NOT EXISTS llm_providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  provider_type VARCHAR(20) NOT NULL CHECK (provider_type IN ('anthropic', 'openai')),
  api_key_encrypted TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  api_base_url TEXT,
  model_name TEXT,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for active provider lookup
CREATE INDEX IF NOT EXISTS idx_llm_providers_active ON llm_providers(is_active) WHERE is_active = TRUE;

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_llm_providers_updated_at ON llm_providers;
CREATE TRIGGER update_llm_providers_updated_at
  BEFORE UPDATE ON llm_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add columns to bot_config if they don't exist (for backwards compatibility)
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS api_base_url TEXT;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS llm_model_name TEXT DEFAULT 'gpt-4o';

-- Migrate existing provider data to new table if exists
DO $$
DECLARE
  config_row RECORD;
BEGIN
  -- Get current config
  SELECT * INTO config_row FROM bot_config WHERE id = 1;

  -- Migrate Anthropic provider if key exists
  IF config_row.anthropic_api_key_encrypted IS NOT NULL AND config_row.encryption_iv IS NOT NULL THEN
    INSERT INTO llm_providers (name, provider_type, api_key_encrypted, encryption_iv, is_active)
    VALUES ('Anthropic Claude', 'anthropic', config_row.anthropic_api_key_encrypted, config_row.encryption_iv, config_row.active_model LIKE 'claude-%')
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Migrate OpenAI provider if key exists
  IF config_row.openai_api_key_encrypted IS NOT NULL AND config_row.encryption_iv IS NOT NULL THEN
    INSERT INTO llm_providers (name, provider_type, api_key_encrypted, encryption_iv, api_base_url, model_name, is_active)
    VALUES (
      'OpenAI GPT',
      'openai',
      config_row.openai_api_key_encrypted,
      config_row.encryption_iv,
      config_row.api_base_url,
      config_row.llm_model_name,
      config_row.active_model LIKE 'gpt-%'
    )
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;
