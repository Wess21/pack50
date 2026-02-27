import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';

/**
 * User entity from database
 */
export interface User {
  id: number;
  telegram_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Find existing user by Telegram ID or create new one
 * Updates user profile if it changed on Telegram
 *
 * @param telegramId - Telegram user ID
 * @param username - Telegram username (without @)
 * @param firstName - Telegram first name
 * @param lastName - Telegram last name
 * @returns User object with database ID
 */
export async function findOrCreateUser(
  telegramId: number,
  username?: string,
  firstName?: string,
  lastName?: string
): Promise<User> {
  try {
    // Try to find existing user
    const findResult = await db.query<User>(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );

    if (findResult.rows.length > 0) {
      // User exists - update profile (user may have changed name on Telegram)
      const updateResult = await db.query<User>(
        `UPDATE users
         SET username = $2, first_name = $3, last_name = $4, updated_at = NOW()
         WHERE telegram_id = $1
         RETURNING *`,
        [telegramId, username, firstName, lastName]
      );

      logger.debug('User updated', {
        telegramId,
        userId: updateResult.rows[0].id,
      });

      return updateResult.rows[0];
    } else {
      // User doesn't exist - create new
      const insertResult = await db.query<User>(
        `INSERT INTO users (telegram_id, username, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING *`,
        [telegramId, username, firstName, lastName]
      );

      logger.info('User created', {
        telegramId,
        userId: insertResult.rows[0].id,
      });

      return insertResult.rows[0];
    }
  } catch (error) {
    logger.error('Failed to find or create user', {
      telegramId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
