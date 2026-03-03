import { Router } from 'express';
import { db } from '../../db/client.js';
import { requireAdmin, AdminRequest } from '../../middleware/admin-auth.js';
import { encryptApiKey, decryptApiKey } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';
import { AnthropicProvider } from '../../services/llm/anthropic-provider.js';
import { OpenAIProvider } from '../../services/llm/openai-provider.js';
import type { LLMProvider } from '../../services/llm/types.js';

const router = Router();

/**
 * GET /api/providers
 * List all LLM providers (without API keys)
 */
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, provider_type, api_base_url, model_name, is_active, created_at, updated_at
       FROM llm_providers
       ORDER BY is_active DESC, created_at ASC`
    );

    res.json(result.rows);
  } catch (error: any) {
    logger.error('Failed to list providers', { error: error.message });
    res.status(500).json({ error: 'Failed to list providers' });
  }
});

/**
 * GET /api/providers/:id
 * Get single provider details (without API key)
 */
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, name, provider_type, api_base_url, model_name, is_active, created_at, updated_at
       FROM llm_providers
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Failed to get provider', { error: error.message });
    res.status(500).json({ error: 'Failed to get provider' });
  }
});

/**
 * POST /api/providers
 * Create new LLM provider
 */
router.post('/', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { name, provider_type, api_key, api_base_url, model_name, is_active } = req.body;

    // Validate required fields
    if (!name || !provider_type || !api_key) {
      res.status(400).json({ error: 'name, provider_type, and api_key are required' });
      return;
    }

    if (!['anthropic', 'openai'].includes(provider_type)) {
      res.status(400).json({ error: 'provider_type must be "anthropic" or "openai"' });
      return;
    }

    // Check for duplicate name
    const existing = await db.query('SELECT id FROM llm_providers WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      res.status(400).json({ error: 'Provider with this name already exists' });
      return;
    }

    // Encrypt API key
    const { encrypted, iv } = encryptApiKey(api_key);

    // If setting as active, deactivate all other providers
    if (is_active) {
      await db.query('UPDATE llm_providers SET is_active = FALSE');
    }

    // Insert new provider
    const result = await db.query(
      `INSERT INTO llm_providers (name, provider_type, api_key_encrypted, encryption_iv, api_base_url, model_name, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, provider_type, api_base_url, model_name, is_active, created_at`,
      [name, provider_type, encrypted, iv, api_base_url || null, model_name || null, is_active || false]
    );

    logger.info('Provider created', {
      adminId: req.adminId,
      providerId: result.rows[0].id,
      providerName: name,
      providerType: provider_type,
    });

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    logger.error('Failed to create provider', { error: error.message });
    res.status(500).json({ error: 'Failed to create provider' });
  }
});

/**
 * PUT /api/providers/:id
 * Update LLM provider
 */
router.put('/:id', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { id } = req.params;
    const { name, api_key, api_base_url, model_name, is_active } = req.body;

    // Check if provider exists
    const existing = await db.query('SELECT * FROM llm_providers WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name) {
      // Check for duplicate name (excluding current provider)
      const duplicate = await db.query(
        'SELECT id FROM llm_providers WHERE name = $1 AND id != $2',
        [name, id]
      );
      if (duplicate.rows.length > 0) {
        res.status(400).json({ error: 'Provider with this name already exists' });
        return;
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }

    if (api_key) {
      const { encrypted, iv } = encryptApiKey(api_key);
      updates.push(`api_key_encrypted = $${paramIndex++}`);
      updates.push(`encryption_iv = $${paramIndex++}`);
      values.push(encrypted, iv);
    }

    if (api_base_url !== undefined) {
      updates.push(`api_base_url = $${paramIndex++}`);
      values.push(api_base_url || null);
    }

    if (model_name !== undefined) {
      updates.push(`model_name = $${paramIndex++}`);
      values.push(model_name || null);
    }

    if (is_active !== undefined) {
      if (is_active) {
        // Deactivate all other providers
        await db.query('UPDATE llm_providers SET is_active = FALSE');
      }
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    values.push(id);

    await db.query(
      `UPDATE llm_providers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
      values
    );

    logger.info('Provider updated', {
      adminId: req.adminId,
      providerId: id,
      fields: updates.join(', '),
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to update provider', { error: error.message });
    res.status(500).json({ error: 'Failed to update provider' });
  }
});

/**
 * DELETE /api/providers/:id
 * Delete LLM provider
 */
router.delete('/:id', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { id } = req.params;

    const result = await db.query('DELETE FROM llm_providers WHERE id = $1 RETURNING id, name', [id]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    logger.info('Provider deleted', {
      adminId: req.adminId,
      providerId: id,
      providerName: result.rows[0].name,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete provider', { error: error.message });
    res.status(500).json({ error: 'Failed to delete provider' });
  }
});

/**
 * POST /api/providers/:id/test
 * Test provider connection
 */
router.post('/:id/test', requireAdmin, async (req, res) => {
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

    const provider = result.rows[0];
    const apiKey = decryptApiKey(provider.api_key_encrypted, provider.encryption_iv);

    let testProvider: LLMProvider;

    if (provider.provider_type === 'anthropic') {
      if (provider.api_base_url) {
        testProvider = new OpenAIProvider(apiKey, {
          baseURL: provider.api_base_url,
          model: provider.model_name || 'anthropic/claude-3-5-sonnet-20241022'
        });
      } else {
        testProvider = new AnthropicProvider(
          apiKey,
          {
            baseURL: undefined,
            model: provider.model_name || 'claude-sonnet-4-5-20250929'
          }
        );
      }
    } else {
      testProvider = new OpenAIProvider(apiKey, {
        baseURL: provider.api_base_url,
        model: provider.model_name || 'gpt-4o',
      });
    }

    const isValid = await testProvider.testConnection();

    if (isValid) {
      res.json({ success: true, message: 'Provider connection successful' });
    } else {
      res.status(400).json({ success: false, message: 'Provider connection failed' });
    }
  } catch (error: any) {
    logger.error('Provider test failed', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/providers/:id/activate
 * Set provider as active (deactivates all others)
 */
router.post('/:id/activate', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const { id } = req.params;

    // Check if provider exists
    const existing = await db.query('SELECT id FROM llm_providers WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    // Deactivate all providers
    await db.query('UPDATE llm_providers SET is_active = FALSE');

    // Activate selected provider
    await db.query('UPDATE llm_providers SET is_active = TRUE WHERE id = $1', [id]);

    logger.info('Provider activated', {
      adminId: req.adminId,
      providerId: id,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to activate provider', { error: error.message });
    res.status(500).json({ error: 'Failed to activate provider' });
  }
});

export default router;
