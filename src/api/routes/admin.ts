import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../../db/client.js';
import { requireAdmin, generateToken, AdminRequest } from '../../middleware/admin-auth.js';
import { encryptApiKey } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';
import { AnthropicProvider } from '../../services/llm/anthropic-provider.js';
import { OpenAIProvider } from '../../services/llm/openai-provider.js';
import type { LLMProvider } from '../../services/llm/types.js';

const router = Router();

/**
 * POST /api/admin/login
 * Public endpoint - authenticate admin user
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const result = await db.query(
      'SELECT id, password_hash FROM admin_users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);

    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = generateToken(admin.id);
    logger.info('Admin login successful', { username, adminId: admin.id });

    res.json({ token, username });
  } catch (error: any) {
    logger.error('Login error', { error: error.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/admin/config
 * Protected - get current bot configuration (without API keys)
 */
router.get('/config', requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT active_model, active_template, webhook_url FROM bot_config WHERE id = 1'
    );

    res.json(result.rows[0] || {});
  } catch (error: any) {
    logger.error('Get config error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

/**
 * PUT /api/admin/config
 * Protected - update bot configuration
 */
router.put('/config', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const {
      active_model,
      active_template,
      webhook_url,
      anthropic_api_key,
      openai_api_key,
    } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (active_model) {
      updates.push(`active_model = $${paramIndex++}`);
      values.push(active_model);
    }

    if (active_template) {
      updates.push(`active_template = $${paramIndex++}`);
      values.push(active_template);
    }

    if (webhook_url !== undefined) {
      updates.push(`webhook_url = $${paramIndex++}`);
      values.push(webhook_url);
    }

    // Encrypt API keys if provided
    if (anthropic_api_key) {
      const { encrypted, iv } = encryptApiKey(anthropic_api_key);
      updates.push(`anthropic_api_key_encrypted = $${paramIndex++}`);
      updates.push(`encryption_iv = $${paramIndex++}`);
      values.push(encrypted, iv);
    }

    if (openai_api_key) {
      const { encrypted, iv } = encryptApiKey(openai_api_key);
      updates.push(`openai_api_key_encrypted = $${paramIndex++}`);
      // Reuse same IV for simplicity (same encryption session)
      if (!anthropic_api_key) {
        updates.push(`encryption_iv = $${paramIndex++}`);
        values.push(iv);
      }
      values[values.length - 2] = encrypted; // Update encrypted value position
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    updates.push(`updated_at = NOW()`);

    await db.query(
      `UPDATE bot_config SET ${updates.join(', ')} WHERE id = 1`,
      values
    );

    logger.info('Bot configuration updated', {
      adminId: req.adminId,
      fields: updates.join(', '),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Update config error', { error: error.message });
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * POST /api/admin/test-model
 * Protected - test API key validity for a provider
 */
router.post('/test-model', requireAdmin, async (req, res) => {
  try {
    const { provider, api_key, model_name } = req.body;

    if (!provider || !api_key) {
      res.status(400).json({ error: 'provider and api_key required' });
      return;
    }

    let testProvider: LLMProvider;

    if (provider === 'anthropic') {
      testProvider = new AnthropicProvider(
        api_key,
        model_name || 'claude-sonnet-4-5-20250929'
      );
    } else if (provider === 'openai') {
      testProvider = new OpenAIProvider(api_key, model_name || 'gpt-4o');
    } else {
      res.status(400).json({ error: 'Invalid provider' });
      return;
    }

    const isValid = await testProvider.testConnection();

    if (isValid) {
      res.json({ success: true, message: 'API key is valid' });
    } else {
      res.status(400).json({ success: false, message: 'API key is invalid' });
    }
  } catch (error: any) {
    logger.error('API key test failed', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
