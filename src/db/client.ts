import pg from 'pg';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const { Pool } = pg;

// Get the directory path for ESM modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create PostgreSQL connection pool
export const db = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Handle connection errors
db.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

/**
 * Initialize database schema
 * Reads and executes schema.sql to create tables, indexes, and triggers
 */
export async function initDatabase(): Promise<void> {
  try {
    // Test database connection
    const client = await db.connect();
    console.log('Database connection established');

    // Read schema file
    const schemaPath = join(__dirname, 'schema.sql');
    const schemaSql = await readFile(schemaPath, 'utf-8');

    // Execute schema
    await client.query(schemaSql);
    console.log('Database schema initialized successfully');

    // Release client back to pool
    client.release();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Close database connection pool
 * Should be called during graceful shutdown
 */
export async function closeDatabase(): Promise<void> {
  await db.end();
  console.log('Database connection closed');
}
