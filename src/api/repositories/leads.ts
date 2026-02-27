import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Lead entity from database
 */
export interface Lead {
  id: number;
  conversation_id: number;
  name: string;
  email: string;
  phone: string;
  additional_info?: any;
  confirmed: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create a new lead with confirmed data
 *
 * @param conversationId - Conversation ID
 * @param name - Lead's name
 * @param email - Lead's email address
 * @param phone - Lead's phone number
 * @param additionalInfo - Optional additional information
 * @returns Created lead
 */
export async function createLead(
  conversationId: number,
  name: string,
  email: string,
  phone: string,
  additionalInfo?: any
): Promise<Lead> {
  try {
    const result = await db.query<Lead>(
      `INSERT INTO leads (conversation_id, name, email, phone, additional_info, confirmed, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
       RETURNING *`,
      [conversationId, name, email, phone, additionalInfo ? JSON.stringify(additionalInfo) : null]
    );

    logger.info('Lead created', {
      conversationId,
      leadId: result.rows[0].id,
      email,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to create lead', {
      conversationId,
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Find lead by email address (for deduplication)
 *
 * @param email - Email address to search for
 * @returns Lead if found, null otherwise
 */
export async function findLeadByEmail(email: string): Promise<Lead | null> {
  try {
    const result = await db.query<Lead>(
      'SELECT * FROM leads WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [email]
    );

    if (result.rows.length > 0) {
      logger.debug('Lead found by email', { email, leadId: result.rows[0].id });
      return result.rows[0];
    }

    return null;
  } catch (error) {
    logger.error('Failed to find lead by email', {
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
