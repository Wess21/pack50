import bcrypt from 'bcrypt';
import { db } from './client.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

const SALT_ROUNDS = 10;

/**
 * Seed default admin user if none exists
 * Default credentials: admin / changeme (configurable via env)
 */
export async function seedAdminUser(): Promise<void> {
  try {
    const defaultUsername = 'admin';
    const defaultPassword = env.DEFAULT_ADMIN_PASSWORD || 'changeme';

    // Check if admin user already exists
    const existing = await db.query(
      'SELECT id FROM admin_users WHERE username = $1',
      [defaultUsername]
    );

    if (existing.rows.length > 0) {
      logger.info('Admin user already exists, skipping seed');
      return;
    }

    // Create default admin user
    const passwordHash = await bcrypt.hash(defaultPassword, SALT_ROUNDS);

    await db.query(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
      [defaultUsername, passwordHash]
    );

    logger.warn(
      `Default admin user created: ${defaultUsername} / ${defaultPassword} - CHANGE PASSWORD IMMEDIATELY!`
    );
  } catch (error: any) {
    logger.error('Failed to seed admin user', { error: error.message });
    // Don't throw - allow app to continue even if seeding fails
  }
}
