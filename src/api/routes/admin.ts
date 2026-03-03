import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../../db/client.js';
import { requireAdmin, generateToken, AdminRequest } from '../../middleware/admin-auth.js';
import { encryptApiKey, decryptApiKey } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';
import { AnthropicProvider } from '../../services/llm/anthropic-provider.js';
import { OpenAIProvider } from '../../services/llm/openai-provider.js';
import type { LLMProvider } from '../../services/llm/types.js';
import { getDashboardMetrics } from '../../services/analytics-queries.js';

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
      'SELECT active_model, active_template, greeting_message, webhook_url, api_base_url, llm_model_name FROM bot_config WHERE id = 1'
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
      greeting_message,
      webhook_url,
      anthropic_api_key,
      openai_api_key,
      api_base_url,
      llm_model_name,
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

    if (greeting_message) {
      updates.push(`greeting_message = $${paramIndex++}`);
      values.push(greeting_message);
    }

    if (webhook_url !== undefined) {
      updates.push(`webhook_url = $${paramIndex++}`);
      values.push(webhook_url);
    }

    if (api_base_url !== undefined) {
      updates.push(`api_base_url = $${paramIndex++}`);
      values.push(api_base_url);
    }

    if (llm_model_name) {
      updates.push(`llm_model_name = $${paramIndex++}`);
      values.push(llm_model_name);
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
      values.push(encrypted);
      // Add IV if not already added by anthropic key
      if (!anthropic_api_key) {
        updates.push(`encryption_iv = $${paramIndex++}`);
        values.push(iv);
      }
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
    const { provider, api_key, model_name, api_base_url } = req.body;

    if (!provider || !api_key) {
      res.status(400).json({ error: 'provider and api_key required' });
      return;
    }

    let testProvider: LLMProvider;

    if (provider === 'anthropic') {
      if (api_base_url) {
        testProvider = new OpenAIProvider(api_key, {
          baseURL: api_base_url,
          model: model_name || 'anthropic/claude-3-5-sonnet-20241022'
        });
      } else {
        testProvider = new AnthropicProvider(
          api_key,
          {
            baseURL: undefined,
            model: model_name || 'claude-sonnet-4-5-20250929'
          }
        );
      }
    } else if (provider === 'openai') {
      testProvider = new OpenAIProvider(api_key, {
        baseURL: api_base_url,
        model: model_name || 'gpt-4o'
      });
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

/**
 * GET /api/admin/analytics
 * Protected - get dashboard metrics
 */
router.get('/analytics', requireAdmin, async (req, res) => {
  try {
    const days = parseInt((req.query.days as string) || '30');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await getDashboardMetrics(startDate, endDate);
    res.json(metrics);
  } catch (error: any) {
    logger.error('Analytics query error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * PUT /api/admin/change-password
 * Protected - change admin user password
 */
router.put('/change-password', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password required' });
      return;
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long' });
      return;
    }

    // Get current password hash
    const result = await db.query(
      'SELECT password_hash FROM admin_users WHERE id = $1',
      [req.adminId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Admin user not found' });
      return;
    }

    const currentHash = result.rows[0].password_hash;

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, currentHash);

    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await db.query(
      'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, req.adminId]
    );

    logger.info('Admin password changed', { adminId: req.adminId });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error: any) {
    logger.error('Change password error', { error: error.message });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * GET /api/admin/providers
 * List all LLM providers (API keys masked)
 */
router.get('/providers', requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, provider_type, api_base_url, model_name, is_active, created_at FROM llm_providers ORDER BY created_at DESC'
    );
    res.json({ providers: result.rows });
  } catch (error: any) {
    logger.error('List providers error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

/**
 * POST /api/admin/providers
 * Create a new LLM provider
 */
router.post('/providers', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { name, provider_type, api_key, api_base_url, model_name } = req.body;

    if (!name || !provider_type || !api_key) {
      res.status(400).json({ error: 'name, provider_type and api_key required' });
      return;
    }

    const { encrypted, iv } = encryptApiKey(api_key);

    const result = await db.query(
      `INSERT INTO llm_providers (name, provider_type, api_key_encrypted, encryption_iv, api_base_url, model_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, provider_type, api_base_url, model_name, is_active`,
      [name, provider_type, encrypted, iv, api_base_url || null, model_name || null]
    );

    logger.info('LLM provider created', { adminId: req.adminId, name });
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    logger.error('Create provider error', { error: error.message });
    if (error.code === '23505') {
      res.status(409).json({ error: 'Провайдер с таким именем уже существует' });
    } else {
      res.status(500).json({ error: 'Failed to create provider' });
    }
  }
});

/**
 * PUT /api/admin/providers/:id
 * Update an existing LLM provider
 */
router.put('/providers/:id', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { id } = req.params;
    const { name, provider_type, api_key, api_base_url, model_name } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name) { updates.push(`name = $${paramIndex++}`); values.push(name); }
    if (provider_type) { updates.push(`provider_type = $${paramIndex++}`); values.push(provider_type); }
    if (api_base_url !== undefined) { updates.push(`api_base_url = $${paramIndex++}`); values.push(api_base_url || null); }
    if (model_name !== undefined) { updates.push(`model_name = $${paramIndex++}`); values.push(model_name || null); }

    if (api_key) {
      const { encrypted, iv } = encryptApiKey(api_key);
      updates.push(`api_key_encrypted = $${paramIndex++}`);
      updates.push(`encryption_iv = $${paramIndex++}`);
      values.push(encrypted, iv);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await db.query(
      `UPDATE llm_providers SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, name, provider_type, api_base_url, model_name, is_active`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    logger.info('LLM provider updated', { adminId: req.adminId, id });
    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Update provider error', { error: error.message });
    res.status(500).json({ error: 'Failed to update provider' });
  }
});

/**
 * DELETE /api/admin/providers/:id
 */
router.delete('/providers/:id', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM llm_providers WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    logger.info('LLM provider deleted', { adminId: req.adminId, id });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Delete provider error', { error: error.message });
    res.status(500).json({ error: 'Failed to delete provider' });
  }
});

/**
 * PATCH /api/admin/providers/:id/activate
 * Set a provider as the active one (deactivates all others)
 */
router.patch('/providers/:id/activate', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE llm_providers SET is_active = FALSE');
    const result = await db.query(
      'UPDATE llm_providers SET is_active = TRUE WHERE id = $1 RETURNING id, name',
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    logger.info('LLM provider activated', { adminId: req.adminId, id });
    res.json({ success: true, active: result.rows[0] });
  } catch (error: any) {
    logger.error('Activate provider error', { error: error.message });
    res.status(500).json({ error: 'Failed to activate provider' });
  }
});

/**
 * POST /api/admin/providers/:id/test
 * Test connectivity for a stored provider (key decrypted server-side)
 */
router.post('/providers/:id/test', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'SELECT provider_type, api_key_encrypted, encryption_iv, api_base_url, model_name FROM llm_providers WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    const p = result.rows[0];
    const apiKey = decryptApiKey(p.api_key_encrypted, p.encryption_iv);

    let testProvider: LLMProvider;
    if (p.provider_type === 'anthropic' && !p.api_base_url) {
      testProvider = new AnthropicProvider(apiKey, {
        baseURL: undefined,
        model: p.model_name || 'claude-sonnet-4-5-20250929'
      });
    } else {
      testProvider = new OpenAIProvider(apiKey, {
        baseURL: p.api_base_url || undefined,
        model: p.model_name || 'gpt-4o'
      });
    }

    const isValid = await testProvider.testConnection();
    if (isValid) {
      res.json({ success: true, message: 'Подключение успешно' });
    } else {
      res.status(400).json({ success: false, message: 'Ключ недействителен' });
    }
  } catch (error: any) {
    logger.error('Provider test failed', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
