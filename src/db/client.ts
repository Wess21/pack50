import pg from 'pg';
import { readFile, readdir } from 'fs/promises';
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

// Export pool as alias for backwards compatibility
export const pool = db;

// Handle connection errors
db.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

export async function initDatabase(): Promise<void> {
  try {
    // Test database connection
    const client = await db.connect();
    console.log('Database connection established');

    // Read and execute base schema file
    const schemaPath = join(__dirname, 'schema.sql');
    const schemaSql = await readFile(schemaPath, 'utf-8');
    await client.query(schemaSql);
    console.log('Database schema initialized successfully');

    // Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Run new migrations
    const migrationsPath = join(__dirname, 'migrations');
    let files: string[] = [];
    try {
      files = await readdir(migrationsPath);
    } catch (e) {
      console.log('No migrations directory found, skipping migrations.');
    }

    // Sort logically to apply in order (e.g. 001_, 002_)
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      const { rows } = await client.query('SELECT id FROM migrations_log WHERE filename = $1', [file]);
      if (rows.length === 0) {
        console.log(`Applying migration: ${file}`);
        const filePath = join(migrationsPath, file);
        const fileSql = await readFile(filePath, 'utf-8');

        await client.query('BEGIN');
        try {
          await client.query(fileSql);
          await client.query('INSERT INTO migrations_log (filename) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`Migration ${file} applied successfully.`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Migration ${file} failed. Rolled back.`);
          throw err;
        }
      }
    }

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
