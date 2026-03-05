-- Add bot_token_encrypted to bot_config
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS bot_token_encrypted TEXT;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS bot_token_iv TEXT;

-- We don't need a trigger since bot_config already has update_updated_at_column
