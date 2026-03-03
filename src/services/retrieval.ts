import { db } from '../db/client.js';
import { embedText } from './embedding.js';
import { logger } from '../utils/logger.js';
import { DocumentsRepository } from '../db/repositories/documents-repository.js';

export interface SearchResult {
  content: string;
  similarity: number;
  citation: {
    source: string;
    page: number | null;
    docType: string;
  };
  metadata: Record<string, any>;
}

export interface SearchOptions {
  k?: number;                    // Top-K results (default: 5)
  minSimilarity?: number;        // Minimum similarity threshold (default: 0.3)
  filters?: {
    docType?: string;            // Filter by doc_type
    source?: string;             // Filter by source filename/URL
    dateFrom?: string;           // Filter by uploaded_at >= date
    dateTo?: string;             // Filter by uploaded_at <= date
  };
}

/**
 * Search document chunks using vector similarity
 * @param query - User's natural language question
 * @param options - Search configuration
 * @returns Top-K most relevant chunks with citations
 */
export async function searchDocuments(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const {
    k = 5,
    minSimilarity = 0.1,  // Lowered from 0.3 for better recall
    filters = {}
  } = options;

  logger.info('Searching documents', { query, k, filters });

  // 1. Embed query
  const queryEmbedding = await embedText(query);
  logger.debug('Query embedding created', {
    embeddingLength: queryEmbedding.length,
    firstValues: queryEmbedding.slice(0, 5)
  });

  // 2. Build SQL with metadata filters
  let sql = `SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity FROM document_chunks`;
  let hasWhere = false;

  // Use JSON.stringify to match format used during document insertion
  const params: any[] = [JSON.stringify(queryEmbedding)];
  let paramIndex = 2;

  // Add metadata filters
  if (filters.docType) {
    sql += hasWhere ? ` AND metadata->>'doc_type' = $${paramIndex}` : ` WHERE metadata->>'doc_type' = $${paramIndex}`;
    params.push(filters.docType);
    paramIndex++;
    hasWhere = true;
  }

  if (filters.source) {
    sql += hasWhere ? ` AND metadata->>'source' = $${paramIndex}` : ` WHERE metadata->>'source' = $${paramIndex}`;
    params.push(filters.source);
    paramIndex++;
    hasWhere = true;
  }

  if (filters.dateFrom) {
    sql += hasWhere ? ` AND metadata->>'uploaded_at' >= $${paramIndex}` : ` WHERE metadata->>'uploaded_at' >= $${paramIndex}`;
    params.push(filters.dateFrom);
    paramIndex++;
    hasWhere = true;
  }

  if (filters.dateTo) {
    sql += hasWhere ? ` AND metadata->>'uploaded_at' <= $${paramIndex}` : ` WHERE metadata->>'uploaded_at' <= $${paramIndex}`;
    params.push(filters.dateTo);
    paramIndex++;
    hasWhere = true;
  }

  // Add similarity threshold and ordering
  // NOTE: ORDER BY with distance operator seems to have issues
  // Use similarity column for ordering instead
  sql += ` ORDER BY similarity DESC LIMIT ${k}`;

  // 3. Execute search
  const startTime = Date.now();
  logger.debug('Executing SQL', {
    sql: sql.substring(0, 200),
    paramsCount: params.length,
    param1Type: typeof params[0],
    param1Length: typeof params[0] === 'string' ? params[0].length : 'N/A',
    paramsList: params.map((p, i) => i === 0 ? `param${i}: [embedding]` : `param${i}: ${p}`)
  });

  // Direct test query to verify params work
  const testResult = await db.query(
    `SELECT COUNT(*) as total FROM document_chunks`
  );
  logger.debug('Total chunks in DB:', testResult.rows[0]);

  const result = await db.query(sql, params);
  const duration = Date.now() - startTime;

  logger.info('Search completed', {
    query,
    resultsFound: result.rows.length,
    durationMs: duration
  });

  if (result.rows.length > 0) {
    logger.debug('Top result', {
      similarity: result.rows[0].similarity,
      source: result.rows[0].metadata?.source
    });
  }

  // 4. Format results with citations
  const searchResults: SearchResult[] = result.rows.map(row => {
    const metadata = row.metadata;

    return {
      content: row.content,
      similarity: parseFloat(row.similarity),
      citation: {
        source: metadata.source || 'Unknown',
        page: metadata.page || null,
        docType: metadata.doc_type || 'unknown'
      },
      metadata
    };
  });

  // 5. Track document usage statistics
  if (searchResults.length > 0) {
    // Collect unique sources from results
    const sources = [...new Set(searchResults.map(r => r.citation.source))];

    // Increment usage count for each document (non-blocking)
    for (const source of sources) {
      DocumentsRepository.incrementUsageCount(source).catch(err => {
        logger.error('Failed to track document usage', { source, error: err.message });
      });
    }
  }

  // 6. Warn if no results found
  if (searchResults.length === 0) {
    logger.warn('No relevant documents found', { query, minSimilarity });
  }

  return searchResults;
}

/**
 * Get document statistics
 * @returns Counts by document type and total chunks
 */
export async function getDocumentStats() {
  const result = await db.query(`
    SELECT
      COUNT(*) as total_chunks,
      COUNT(DISTINCT metadata->>'source') as unique_documents,
      COUNT(*) FILTER (WHERE metadata->>'doc_type' = 'pdf') as pdf_chunks,
      COUNT(*) FILTER (WHERE metadata->>'doc_type' = 'docx') as docx_chunks,
      COUNT(*) FILTER (WHERE metadata->>'doc_type' = 'url') as url_chunks
    FROM document_chunks
  `);

  return result.rows[0];
}

/**
 * Format search results as citation text for bot responses
 * @param results - Search results
 * @returns Formatted string with citations
 */
export function formatCitations(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'Источники: не найдено релевантных документов';
  }

  const citations = results.map((result, index) => {
    const pageInfo = result.citation.page
      ? `, страница ${result.citation.page}`
      : '';

    return `${index + 1}. ${result.citation.source}${pageInfo} (релевантность: ${(result.similarity * 100).toFixed(1)}%)`;
  });

  return `Источники:\n${citations.join('\n')}`;
}

/**
 * Extract context from search results for LLM prompting
 * @param results - Search results
 * @returns Concatenated context with source markers
 */
export function extractContext(results: SearchResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const contextChunks = results.map((result) => result.content);

  return contextChunks.join('\n\n---\n\n');
}

export const RetrievalService = {
  searchDocuments,
  getDocumentStats,
  formatCitations,
  extractContext
};
