import { pool } from '../client.js';
import { logger } from '../../utils/logger.js';

export interface Document {
  id: number;
  source: string;
  source_type: 'pdf' | 'docx' | 'txt' | 'url';
  title: string | null;
  description: string | null;
  tags: string[] | null;
  priority: number;
  chunk_count: number;
  total_size_bytes: number | null;
  status: 'active' | 'archived' | 'processing' | 'failed';
  upload_date: Date;
  last_used_at: Date | null;
  usage_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDocumentParams {
  source: string;
  source_type: 'pdf' | 'docx' | 'txt' | 'url';
  title?: string;
  description?: string;
  tags?: string[];
  total_size_bytes?: number;
}

export interface UpdateDocumentMetadataParams {
  title?: string;
  description?: string;
  tags?: string[];
  priority?: number;
}

export interface DocumentStats {
  total_documents: number;
  total_chunks: number;
  by_type: {
    pdf: number;
    docx: number;
    txt: number;
    url: number;
  };
  most_used: Array<{
    source: string;
    title: string | null;
    usage_count: number;
  }>;
}

/**
 * Repository for document management operations
 */
export class DocumentsRepository {
  /**
   * Create a new document record
   */
  static async createDocument(params: CreateDocumentParams): Promise<Document> {
    const { source, source_type, title, description, tags, total_size_bytes } = params;

    const result = await pool.query<Document>(
      `INSERT INTO documents (source, source_type, title, description, tags, total_size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'processing')
       RETURNING *`,
      [source, source_type, title, description, tags || [], total_size_bytes]
    );

    return result.rows[0];
  }

  /**
   * Get all documents with optional filters
   */
  static async listDocuments(filters?: {
    status?: string;
    source_type?: string;
    search?: string;
  }): Promise<Document[]> {
    let query = 'SELECT * FROM documents WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters?.source_type) {
      query += ` AND source_type = $${paramIndex}`;
      params.push(filters.source_type);
      paramIndex++;
    }

    if (filters?.search) {
      query += ` AND (source ILIKE $${paramIndex} OR title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    query += ' ORDER BY upload_date DESC';

    const result = await pool.query<Document>(query, params);
    return result.rows;
  }

  /**
   * Get document by ID
   */
  static async getDocumentById(id: number): Promise<Document | null> {
    const result = await pool.query<Document>(
      'SELECT * FROM documents WHERE id = $1',
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * Get document by source
   */
  static async getDocumentBySource(source: string): Promise<Document | null> {
    const result = await pool.query<Document>(
      'SELECT * FROM documents WHERE source = $1',
      [source]
    );

    return result.rows[0] || null;
  }

  /**
   * Update document metadata
   */
  static async updateDocumentMetadata(
    id: number,
    params: UpdateDocumentMetadataParams
  ): Promise<Document | null> {
    const { title, description, tags, priority } = params;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(title);
      paramIndex++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(description);
      paramIndex++;
    }

    if (tags !== undefined) {
      updates.push(`tags = $${paramIndex}`);
      values.push(tags);
      paramIndex++;
    }

    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex}`);
      values.push(priority);
      paramIndex++;
    }

    if (updates.length === 0) {
      return this.getDocumentById(id);
    }

    values.push(id);

    const result = await pool.query<Document>(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  /**
   * Update document status
   */
  static async updateDocumentStatus(
    source: string,
    status: 'active' | 'archived' | 'processing' | 'failed',
    chunkCount?: number
  ): Promise<void> {
    if (chunkCount !== undefined) {
      await pool.query(
        'UPDATE documents SET status = $1, chunk_count = $2 WHERE source = $3',
        [status, chunkCount, source]
      );
    } else {
      await pool.query(
        'UPDATE documents SET status = $1 WHERE source = $2',
        [status, source]
      );
    }
  }

  /**
   * Increment usage count for a document
   */
  static async incrementUsageCount(source: string): Promise<void> {
    await pool.query(
      `UPDATE documents
       SET usage_count = usage_count + 1, last_used_at = NOW()
       WHERE source = $1`,
      [source]
    );
  }

  /**
   * Delete document and all its chunks
   */
  static async deleteDocument(id: number): Promise<boolean> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get document source first
      const docResult = await client.query<{ source: string }>(
        'SELECT source FROM documents WHERE id = $1',
        [id]
      );

      if (docResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const source = docResult.rows[0].source;

      // Delete all chunks from this document
      await client.query(
        'DELETE FROM document_chunks WHERE source = $1',
        [source]
      );

      // Delete document record
      await client.query('DELETE FROM documents WHERE id = $1', [id]);

      await client.query('COMMIT');

      logger.info('Document deleted', { id, source });
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to delete document', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get document statistics
   */
  static async getDocumentStats(): Promise<DocumentStats> {
    // Total documents and chunks
    const totalsResult = await pool.query<{
      total_documents: string;
      total_chunks: string;
    }>(
      `SELECT
        COUNT(*)::text as total_documents,
        COALESCE(SUM(chunk_count), 0)::text as total_chunks
       FROM documents
       WHERE status = 'active'`
    );

    // By type
    const byTypeResult = await pool.query<{
      source_type: string;
      count: string;
    }>(
      `SELECT source_type, COUNT(*)::text as count
       FROM documents
       WHERE status = 'active'
       GROUP BY source_type`
    );

    const by_type = {
      pdf: 0,
      docx: 0,
      txt: 0,
      url: 0,
    };

    byTypeResult.rows.forEach((row: { source_type: string; count: string }) => {
      const type = row.source_type as keyof typeof by_type;
      by_type[type] = parseInt(row.count, 10);
    });

    // Most used documents
    const mostUsedResult = await pool.query<{
      source: string;
      title: string | null;
      usage_count: number;
    }>(
      `SELECT source, title, usage_count
       FROM documents
       WHERE status = 'active'
       ORDER BY usage_count DESC
       LIMIT 5`
    );

    return {
      total_documents: parseInt(totalsResult.rows[0]?.total_documents || '0', 10),
      total_chunks: parseInt(totalsResult.rows[0]?.total_chunks || '0', 10),
      by_type,
      most_used: mostUsedResult.rows,
    };
  }

  /**
   * Archive document (soft delete)
   */
  static async archiveDocument(id: number): Promise<boolean> {
    const result = await pool.query(
      'UPDATE documents SET status = $1 WHERE id = $2',
      ['archived', id]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }
}
