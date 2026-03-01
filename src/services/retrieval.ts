import { db } from '../db/client.js';
import { embedText } from './embedding.js';
import { logger } from '../utils/logger.js';

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
    minSimilarity = 0.3,
    filters = {}
  } = options;

  logger.info('Searching documents', { query, k, filters });

  // 1. Embed query
  const queryEmbedding = await embedText(query);

  // 2. Build SQL with metadata filters
  let sql = `
    SELECT
      content,
      metadata,
      1 - (embedding <=> $1::vector) as similarity
    FROM document_chunks
    WHERE 1=1
  `;

  const params: any[] = [JSON.stringify(queryEmbedding)];
  let paramIndex = 2;

  // Add metadata filters
  if (filters.docType) {
    sql += ` AND metadata->>'doc_type' = $${paramIndex}`;
    params.push(filters.docType);
    paramIndex++;
  }

  if (filters.source) {
    sql += ` AND metadata->>'source' = $${paramIndex}`;
    params.push(filters.source);
    paramIndex++;
  }

  if (filters.dateFrom) {
    sql += ` AND metadata->>'uploaded_at' >= $${paramIndex}`;
    params.push(filters.dateFrom);
    paramIndex++;
  }

  if (filters.dateTo) {
    sql += ` AND metadata->>'uploaded_at' <= $${paramIndex}`;
    params.push(filters.dateTo);
    paramIndex++;
  }

  // Add similarity threshold and ordering
  sql += `
    AND (1 - (embedding <=> $1::vector)) >= $${paramIndex}
    ORDER BY embedding <=> $1::vector
    LIMIT $${paramIndex + 1}
  `;
  params.push(minSimilarity);
  params.push(k);

  // 3. Execute search
  const startTime = Date.now();
  const result = await db.query(sql, params);
  const duration = Date.now() - startTime;

  logger.info('Search completed', {
    query,
    resultsFound: result.rows.length,
    durationMs: duration
  });

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

  // 5. Warn if no results found
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

  const contextChunks = results.map((result, index) => {
    const sourceLabel = `[Источник ${index + 1}: ${result.citation.source}${
      result.citation.page ? `, стр. ${result.citation.page}` : ''
    }]`;

    return `${sourceLabel}\n${result.content}`;
  });

  return contextChunks.join('\n\n---\n\n');
}

export const RetrievalService = {
  searchDocuments,
  getDocumentStats,
  formatCitations,
  extractContext
};
