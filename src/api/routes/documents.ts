import express, { Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { processPDF, processDOCX, processURL, processTXT, processXLSX } from '../../services/document-processing.js';
import { logger } from '../../utils/logger.js';
import { DocumentsRepository } from '../../db/repositories/documents-repository.js';
import { requireAdmin } from '../../middleware/admin-auth.js';
import { db } from '../../db/client.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024  // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',   // xlsx
      'application/vnd.ms-excel',                                             // xls
      'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX and TXT allowed.'));
    }
  }
});

// In-memory job tracking (use Redis in production)
const jobs = new Map<string, any>();

/**
 * POST /api/documents/upload
 * Upload PDF or DOCX file for processing
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const jobId = uuidv4();
    const filePath = req.file.path;
    // multer encodes originalname as latin1 bytes; decode to UTF-8 to fix Cyrillic filenames
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const fileType = path.extname(filename).toLowerCase();

    logger.info('Document upload received', { jobId, filename, fileType });

    // Store initial job status
    jobs.set(jobId, {
      status: 'processing',
      filename,
      createdAt: new Date()
    });

    // Immediately create a 'processing' row so the file appears in the UI right away
    const fileExt = fileType.replace('.', '') as any;
    try {
      await db.query(
        `INSERT INTO documents (source, source_type, title, status, upload_date)
         VALUES ($1, $2, $3, 'processing', NOW())
         ON CONFLICT (source) DO UPDATE SET status = 'processing', updated_at = NOW()`,
        [filename, fileExt, filename]
      );
    } catch (dbErr: any) {
      logger.warn('Could not create processing row in documents', { error: dbErr.message });
    }

    // Resolve unsupported types before sending the response
    if (!['.pdf', '.docx', '.txt', '.xlsx', '.xls'].includes(fileType)) {
      res.status(400).json({ error: 'Unsupported file type' });
      return;
    }

    // Send 202 IMMEDIATELY — before any heavy processing starts
    // This ensures the browser gets the response and the event loop stays free
    res.status(202).json({
      jobId,
      status: 'processing',
      message: 'Document processing started'
    });

    // Defer heavy CPU/IO work to AFTER the response is flushed
    setImmediate(() => {
      let job: Promise<any>;

      if (fileType === '.pdf') {
        job = processPDF(filePath, jobId, filename);
      } else if (fileType === '.docx') {
        job = processDOCX(filePath, jobId, filename);
      } else if (fileType === '.txt') {
        job = processTXT(filePath, jobId, filename);
      } else {
        job = processXLSX(filePath, jobId, filename);
      }

      job.then(result => {
        jobs.set(jobId, result);
      }).catch(err => {
        logger.error('Background processing error', { jobId, error: err.message });
        jobs.set(jobId, { jobId, status: 'failed', error: err.message });
      });
    });

  } catch (error: any) {
    logger.error('Upload error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/documents/url
 * Add URL for content extraction
 */
router.post('/url', async (req: Request, res: Response): Promise<void> => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'URL is required' });
      return;
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    const jobId = uuidv4();

    logger.info('URL processing requested', { jobId, url });

    jobs.set(jobId, {
      status: 'processing',
      url,
      createdAt: new Date()
    });

    // Process in background
    processURL(url, jobId).then(result => {
      jobs.set(jobId, result);
    });

    res.status(202).json({
      jobId,
      status: 'processing',
      message: 'URL processing started'
    });
  } catch (error: any) {
    logger.error('URL processing error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/documents/status/:jobId
 * Check processing status
 */
router.get('/status/:jobId', (req: Request, res: Response): void => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json(job);
});

/**
 * GET /api/documents
 * List all documents with metadata (requires admin auth)
 */
router.get('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, source_type, search } = req.query;

    const filters = {
      status: status as string | undefined,
      source_type: source_type as string | undefined,
      search: search as string | undefined,
    };

    const documents = await DocumentsRepository.listDocuments(filters);

    res.json({
      documents,
      total: documents.length,
    });
  } catch (error) {
    logger.error('Failed to list documents', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * GET /api/documents/stats
 * Get document statistics (requires admin auth)
 */
router.get('/stats', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = await DocumentsRepository.getDocumentStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get document stats', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to get document stats' });
  }
});

/**
 * PUT /api/documents/:id/metadata
 * Update document metadata (requires admin auth)
 */
router.put('/:id/metadata', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const { title, description, tags, priority } = req.body;

    const document = await DocumentsRepository.updateDocumentMetadata(id, {
      title,
      description,
      tags,
      priority,
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json(document);
  } catch (error) {
    logger.error('Failed to update document metadata', {
      error: error instanceof Error ? error.message : String(error),
      id: req.params.id,
    });
    res.status(500).json({ error: 'Failed to update document metadata' });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete document and all its chunks (requires admin auth)
 */
router.delete('/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const deleted = await DocumentsRepository.deleteDocument(id);

    if (!deleted) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete document', {
      error: error instanceof Error ? error.message : String(error),
      id: req.params.id,
    });
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * PUT /api/documents/:id/archive
 * Archive document (soft delete, requires admin auth)
 */
router.put('/:id/archive', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }

    const archived = await DocumentsRepository.archiveDocument(id);

    if (!archived) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({ success: true, message: 'Document archived successfully' });
  } catch (error) {
    logger.error('Failed to archive document', {
      error: error instanceof Error ? error.message : String(error),
      id: req.params.id,
    });
    res.status(500).json({ error: 'Failed to archive document' });
  }
});

export default router;
