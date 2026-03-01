import { loadPDF } from '../loaders/pdf-loader.js';
import { loadDOCX } from '../loaders/docx-loader.js';
import { loadURL } from '../loaders/web-loader.js';
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

    // 4. Store in database
    const timestamp = new Date().toISOString();

    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      const embedding = embeddings[i];

      await db.query(
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
            chunk_index: i,
            job_id: jobId
          })
        ]
      );
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

    const timestamp = new Date().toISOString();

    for (let i = 0; i < chunks.length; i++) {
      await db.query(
        `INSERT INTO document_chunks (content, embedding, metadata)
         VALUES ($1, $2, $3)`,
        [
          chunks[i].text,
          JSON.stringify(embeddings[i]),
          JSON.stringify({
            source: filename,
            page: null,  // DOCX doesn't have page numbers
            doc_type: 'docx',
            uploaded_at: timestamp,
            chunk_index: i,
            job_id: jobId
          })
        ]
      );
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

    const timestamp = new Date().toISOString();

    for (let i = 0; i < chunks.length; i++) {
      await db.query(
        `INSERT INTO document_chunks (content, embedding, metadata)
         VALUES ($1, $2, $3)`,
        [
          chunks[i].text,
          JSON.stringify(embeddings[i]),
          JSON.stringify({
            source: url,
            page: null,
            doc_type: 'url',
            uploaded_at: timestamp,
            chunk_index: i,
            job_id: jobId
          })
        ]
      );
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
    return {
      jobId,
      status: 'failed',
      error: error.message
    };
  }
}
