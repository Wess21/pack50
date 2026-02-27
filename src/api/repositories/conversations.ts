import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Conversation entity from database
 */
export interface Conversation {
  id: number;
  user_id: number;
  started_at: Date;
  ended_at?: Date;
  status: string;
  lead_data?: any;
  created_at: Date;
  updated_at: Date;
}

/**
 * Message entity from database
 */
export interface Message {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  metadata?: any;
  created_at: Date;
}

/**
 * Create new conversation for user
 *
 * @param userId - Database user ID (not Telegram ID)
 * @returns Created conversation
 */
export async function createConversation(userId: number): Promise<Conversation> {
  try {
    const result = await db.query<Conversation>(
      `INSERT INTO conversations (user_id, started_at, status, created_at, updated_at)
       VALUES ($1, NOW(), 'active', NOW(), NOW())
       RETURNING *`,
      [userId]
    );

    logger.info('Conversation created', {
      userId,
      conversationId: result.rows[0].id,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to create conversation', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Add message to conversation
 *
 * @param conversationId - Conversation ID
 * @param role - Message author role (user or assistant)
 * @param content - Message text content
 * @param metadata - Optional metadata (e.g., extracted data, sentiment)
 * @returns Created message
 */
export async function addMessage(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  metadata?: any
): Promise<Message> {
  try {
    const result = await db.query<Message>(
      `INSERT INTO messages (conversation_id, role, content, metadata, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [conversationId, role, content, metadata ? JSON.stringify(metadata) : null]
    );

    logger.debug('Message added', {
      conversationId,
      messageId: result.rows[0].id,
      role,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to add message', {
      conversationId,
      role,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Update conversation lead data (extracted information)
 *
 * @param conversationId - Conversation ID
 * @param leadData - Lead information (name, email, phone, etc.)
 */
export async function updateConversationLeadData(
  conversationId: number,
  leadData: any
): Promise<void> {
  try {
    await db.query(
      `UPDATE conversations
       SET lead_data = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(leadData), conversationId]
    );

    logger.debug('Conversation lead data updated', {
      conversationId,
      leadData,
    });
  } catch (error) {
    logger.error('Failed to update conversation lead data', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get recent messages from conversation
 *
 * @param conversationId - Conversation ID
 * @param limit - Maximum number of messages to return
 * @returns Array of messages (most recent first)
 */
export async function getConversationMessages(
  conversationId: number,
  limit: number = 10
): Promise<Message[]> {
  try {
    const result = await db.query<Message>(
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit]
    );

    return result.rows;
  } catch (error) {
    logger.error('Failed to get conversation messages', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
