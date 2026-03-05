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
    minSimilarity = 0.05,  // Very low threshold — diversity logic handles quality
    filters = {}
  } = options;

  logger.info('Searching documents', { query, k, filters });

  // 1. Embed query
  const queryEmbedding = await embedText(query);

  // 2. Build Hybrid SQL — fetch candidates from both Vector Search and FTS
  const CANDIDATES = Math.max(k * 3, 20); // Reduced batch size for faster sorting

  let vectorWhere = `1 - (embedding <=> $1::vector) >= ${minSimilarity}`;
  // Use the pre-computed FTS generated index instead of doing it on the fly
  let ftsWhere = `content_tsvector @@ websearch_to_tsquery('russian', $2)`;

  // Convert natural language query into an "OR" search for Postgres FTS
  // e.g. "какие есть шуруповерты" -> "какие OR есть OR шуруповерты"
  const ftsQuery = query.trim().split(/\s+/).join(' OR ') || query;

  const params: any[] = [JSON.stringify(queryEmbedding), ftsQuery];
  let paramIndex = 3;

  if (filters.docType) {
    const clause = ` AND metadata->>'doc_type' = $${paramIndex}`;
    vectorWhere += clause; ftsWhere += clause;
    params.push(filters.docType); paramIndex++;
  }
  if (filters.source) {
    const clause = ` AND metadata->>'source' = $${paramIndex}`;
    vectorWhere += clause; ftsWhere += clause;
    params.push(filters.source); paramIndex++;
  }
  if (filters.dateFrom) {
    const clause = ` AND metadata->>'uploaded_at' >= $${paramIndex}`;
    vectorWhere += clause; ftsWhere += clause;
    params.push(filters.dateFrom); paramIndex++;
  }
  if (filters.dateTo) {
    const clause = ` AND metadata->>'uploaded_at' <= $${paramIndex}`;
    vectorWhere += clause; ftsWhere += clause;
    params.push(filters.dateTo); paramIndex++;
  }

  const sql = `
    WITH vector_search AS (
      SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity 
      FROM document_chunks 
      WHERE ${vectorWhere} 
      ORDER BY similarity DESC LIMIT ${CANDIDATES}
    ),
    fts_search AS (
      SELECT content, metadata, 1.0 as similarity 
      FROM document_chunks 
      WHERE ${ftsWhere}
      LIMIT ${CANDIDATES}
    )
    SELECT * FROM fts_search
    UNION
    SELECT * FROM vector_search
    ORDER BY similarity DESC
    LIMIT ${CANDIDATES}
  `;

  // 3. Execute search
  const startTime = Date.now();
  const result = await db.query(sql, params);
  const duration = Date.now() - startTime;

  logger.info('Search completed', {
    query,
    candidatesFound: result.rows.length,
    durationMs: duration
  });

  // 4. Parse all candidates
  const candidates: SearchResult[] = result.rows.map(row => ({
    content: row.content,
    similarity: parseFloat(row.similarity),
    citation: {
      source: row.metadata.source || 'Unknown',
      page: row.metadata.page || null,
      docType: row.metadata.doc_type || 'unknown'
    },
    metadata: row.metadata
  }));

  // 5. Diversity reranking:
  //    - Always include the best chunk from each unique source document
  //    - Then fill remaining slots with highest-similarity chunks (dedup)
  const bySource = new Map<string, SearchResult>();
  for (const c of candidates) {
    const src = c.citation.source;
    if (!bySource.has(src) || c.similarity > bySource.get(src)!.similarity) {
      bySource.set(src, c);
    }
  }

  // Start with one representative per source (sorted by their best similarity)
  const diverse = Array.from(bySource.values()).sort((a, b) => b.similarity - a.similarity);

  // Fill remaining k slots with remaining candidates (not already in diverse)
  const diverseSet = new Set(diverse.map(r => r.content));
  for (const c of candidates) {
    if (diverse.length >= k) break;
    if (!diverseSet.has(c.content)) {
      diverse.push(c);
      diverseSet.add(c.content);
    }
  }

  // Final result: top k sorted by similarity
  const searchResults = diverse.slice(0, k).sort((a, b) => b.similarity - a.similarity);

  if (searchResults.length > 0) {
    logger.debug('Top result after diversity reranking', {
      similarity: searchResults[0].similarity,
      source: searchResults[0].citation.source,
      uniqueSources: diverse.length
    });
  }

  // 6. Track document usage statistics
  if (searchResults.length > 0) {
    const sources = [...new Set(searchResults.map(r => r.citation.source))];
    for (const source of sources) {
      DocumentsRepository.incrementUsageCount(source).catch(err => {
        logger.error('Failed to track document usage', { source, error: err.message });
      });
    }
  }

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
