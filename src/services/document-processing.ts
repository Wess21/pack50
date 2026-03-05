import { loadPDF } from '../loaders/pdf-loader.js';
import { loadDOCX } from '../loaders/docx-loader.js';
import { loadURL } from '../loaders/web-loader.js';
import { loadTXT } from '../loaders/txt-loader.js';
import { loadXLSX } from '../loaders/xlsx-loader.js';
import { RecursiveCharacterTextSplitter } from './text-splitter.js';
import { embedBatch } from './embedding.js';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,  // 20% overlap
  separators: ['\n\n', '\n', '. ', ' ', '']
});

export interface ProcessingJob {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  chunksCreated?: number;
  error?: string;
}

/** Insert or update a document record and return its DB id */
async function upsertDocument(source: string, sourceType: string, chunkCount: number, sizeBytes: number): Promise<number> {
  const result = await db.query(
    `INSERT INTO documents (source, source_type, title, chunk_count, total_size_bytes, status, upload_date)
     VALUES ($1, $2, $3, $4, $5, 'active', NOW())
     ON CONFLICT (source) DO UPDATE
       SET chunk_count = EXCLUDED.chunk_count,
           total_size_bytes = EXCLUDED.total_size_bytes,
           status = 'active',
           updated_at = NOW()
     RETURNING id`,
    [source, sourceType, source, chunkCount, sizeBytes]
  );
  return result.rows[0].id;
}

/** Mark a document as failed in the DB after a processing error */
async function markDocumentFailed(source: string): Promise<void> {
  try {
    await db.query(
      `UPDATE documents SET status = 'failed', updated_at = NOW() WHERE source = $1`,
      [source]
    );
  } catch (e) { /* ignore secondary failures */ }
}

/**
 * Process PDF document: load → chunk → embed → store
 */
export async function processPDF(
  filePath: string,
  jobId: string,
  filename: string
): Promise<ProcessingJob> {
  try {
    logger.info('Processing PDF', { jobId, filename });

    // 1. Load PDF
    const doc = await loadPDF(filePath);

    // 2. Chunk each page
    const allChunks: Array<{
      text: string;
      page: number;
    }> = [];

    for (const page of doc.pages) {
      const chunks = textSplitter.splitText(page.text);
      chunks.forEach(chunk => {
        allChunks.push({
          text: chunk.text,
          page: page.pageNumber
        });
      });
    }

    // 3. Generate embeddings (batch)
    const texts = allChunks.map(c => c.text);
    const embeddings = await embedBatch(texts);

    // 4. Upsert document record
    const totalBytes = allChunks.reduce((s, c) => s + Buffer.byteLength(c.text, 'utf8'), 0);
    await upsertDocument(filename, 'pdf', allChunks.length, totalBytes);

    // 5. Store chunks in database in batches
    const timestamp = new Date().toISOString();
    const batchSize = 50;

    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);

      // Yield strictly before each DB batch to prevent timeout
      await new Promise<void>(resolve => setImmediate(resolve));

      const queries = batch.map((chunk, idx) => {
        const globalIdx = i + idx;
        const embedding = embeddings[globalIdx];
        return db.query(
          `INSERT INTO document_chunks (content, embedding, metadata)
           VALUES ($1, $2, $3)`,
          [
            chunk.text,
            JSON.stringify(embedding),  // pgvector accepts array as JSON
            JSON.stringify({
              source: filename,
              page: chunk.page,
              doc_type: 'pdf',
              uploaded_at: timestamp,
              chunk_index: globalIdx,
              job_id: jobId
            })
          ]
        );
      });

      await Promise.all(queries);
    }

    logger.info('PDF processing complete', {
      jobId,
      chunksCreated: allChunks.length
    });

    return {
      jobId,
      status: 'completed',
      chunksCreated: allChunks.length
    };
  } catch (error: any) {
    logger.error('PDF processing failed', { jobId, error: error.message });
    await markDocumentFailed(filename);
    return {
      jobId,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Process DOCX document
 */
export async function processDOCX(
  filePath: string,
  jobId: string,
  filename: string
): Promise<ProcessingJob> {
  try {
    logger.info('Processing DOCX', { jobId, filename });

    const doc = await loadDOCX(filePath);
    const chunks = textSplitter.splitText(doc.text);
    const texts = chunks.map(c => c.text);
    const embeddings = await embedBatch(texts);

    // Upsert document record
    const totalBytes = texts.reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0);
    await upsertDocument(filename, 'docx', chunks.length, totalBytes);

    const timestamp = new Date().toISOString();
    const batchSize = 50;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await new Promise<void>(resolve => setImmediate(resolve));

      const queries = batch.map((chunk, idx) => {
        const globalIdx = i + idx;
        return db.query(
          `INSERT INTO document_chunks (content, embedding, metadata)
           VALUES ($1, $2, $3)`,
          [
            chunk.text,
            JSON.stringify(embeddings[globalIdx]),
            JSON.stringify({
              source: filename,
              page: null,  // DOCX doesn't have page numbers
              doc_type: 'docx',
              uploaded_at: timestamp,
              chunk_index: globalIdx,
              job_id: jobId
            })
          ]
        );
      });
      await Promise.all(queries);
    }

    logger.info('DOCX processing complete', {
      jobId,
      chunksCreated: chunks.length
    });

    return {
      jobId,
      status: 'completed',
      chunksCreated: chunks.length
    };
  } catch (error: any) {
    logger.error('DOCX processing failed', { jobId, error: error.message });
    await markDocumentFailed(filename);
    return {
      jobId,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Process URL content
 */
export async function processURL(
  url: string,
  jobId: string
): Promise<ProcessingJob> {
  try {
    logger.info('Processing URL', { jobId, url });

    const doc = await loadURL(url);
    const chunks = textSplitter.splitText(doc.text);
    const texts = chunks.map(c => c.text);
    const embeddings = await embedBatch(texts);

    // Upsert document record
    const totalBytes = texts.reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0);
    await upsertDocument(url, 'url', chunks.length, totalBytes);

    const timestamp = new Date().toISOString();
    const batchSize = 50;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await new Promise<void>(resolve => setImmediate(resolve));

      const queries = batch.map((chunk, idx) => {
        const globalIdx = i + idx;
        return db.query(
          `INSERT INTO document_chunks (content, embedding, metadata)
           VALUES ($1, $2, $3)`,
          [
            chunk.text,
            JSON.stringify(embeddings[globalIdx]),
            JSON.stringify({
              source: url,
              page: null,
              doc_type: 'url',
              uploaded_at: timestamp,
              chunk_index: globalIdx,
              job_id: jobId
            })
          ]
        );
      });
      await Promise.all(queries);
    }

    logger.info('URL processing complete', {
      jobId,
      chunksCreated: chunks.length
    });

    return {
      jobId,
      status: 'completed',
      chunksCreated: chunks.length
    };
  } catch (error: any) {
    logger.error('URL processing failed', { jobId, error: error.message });
    await markDocumentFailed(url);
    return {
      jobId,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Process plain text file
 */
export async function processTXT(
  filePath: string,
  jobId: string,
  filename: string
): Promise<ProcessingJob> {
  try {
    logger.info('Processing TXT', { jobId, filename });

    const doc = await loadTXT(filePath, filename);
    const chunks = textSplitter.splitText(doc.text);
    const texts = chunks.map(c => c.text);
    const embeddings = await embedBatch(texts);

    // Upsert document record
    const totalBytes = texts.reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0);
    await upsertDocument(filename, 'txt', chunks.length, totalBytes);

    const timestamp = new Date().toISOString();
    const batchSize = 50;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await new Promise<void>(resolve => setImmediate(resolve));

      const queries = batch.map((chunk, idx) => {
        const globalIdx = i + idx;
        return db.query(
          `INSERT INTO document_chunks (content, embedding, metadata)
           VALUES ($1, $2, $3)`,
          [
            chunk.text,
            JSON.stringify(embeddings[globalIdx]),
            JSON.stringify({
              source: filename,
              page: null,
              doc_type: 'txt',
              uploaded_at: timestamp,
              chunk_index: globalIdx,
              job_id: jobId
            })
          ]
        );
      });
      await Promise.all(queries);
    }

    logger.info('TXT processing complete', {
      jobId,
      chunksCreated: chunks.length
    });

    return {
      jobId,
      status: 'completed',
      chunksCreated: chunks.length
    };
  } catch (error: any) {
    logger.error('TXT processing failed', { jobId, error: error.message });
    await markDocumentFailed(filename);
    return {
      jobId,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Process Excel file (xlsx/xls)
 */
export async function processXLSX(
  filePath: string,
  jobId: string,
  filename: string
): Promise<ProcessingJob> {
  try {
    logger.info('Processing XLSX', { jobId, filename });

    const doc = await loadXLSX(filePath);
    const chunks = textSplitter.splitText(doc.text);
    const texts = chunks.map(c => c.text);
    const embeddings = await embedBatch(texts);

    // Upsert document record
    const totalBytes = texts.reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0);
    await upsertDocument(filename, 'xlsx', chunks.length, totalBytes);

    const timestamp = new Date().toISOString();
    const batchSize = 50;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await new Promise<void>(resolve => setImmediate(resolve));

      const queries = batch.map((chunk, idx) => {
        const globalIdx = i + idx;
        return db.query(
          `INSERT INTO document_chunks (content, embedding, metadata)
           VALUES ($1, $2, $3)`,
          [
            chunk.text,
            JSON.stringify(embeddings[globalIdx]),
            JSON.stringify({
              source: filename,
              page: null,
              doc_type: 'xlsx',
              uploaded_at: timestamp,
              chunk_index: globalIdx,
              job_id: jobId
            })
          ]
        );
      });
      await Promise.all(queries);
    }

    logger.info('XLSX processing complete', { jobId, chunksCreated: chunks.length });

    return { jobId, status: 'completed', chunksCreated: chunks.length };
  } catch (error: any) {
    logger.error('XLSX processing failed', { jobId, error: error.message });
    await markDocumentFailed(filename);
    return { jobId, status: 'failed', error: error.message };
  }
}
