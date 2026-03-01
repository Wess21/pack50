import express, { Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { processPDF, processDOCX, processURL } from '../../services/document-processing.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024  // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and DOCX allowed.'));
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
    const filename = req.file.originalname;
    const fileType = path.extname(filename).toLowerCase();

    logger.info('Document upload received', { jobId, filename, fileType });

    // Store initial job status
    jobs.set(jobId, {
      status: 'processing',
      filename,
      createdAt: new Date()
    });

    // Process in background (don't await)
    if (fileType === '.pdf') {
      processPDF(filePath, jobId, filename).then(result => {
        jobs.set(jobId, result);
      });
    } else if (fileType === '.docx') {
      processDOCX(filePath, jobId, filename).then(result => {
        jobs.set(jobId, result);
      });
    } else {
      res.status(400).json({ error: 'Unsupported file type' });
      return;
    }

    // Return immediately with job ID
    res.status(202).json({
      jobId,
      status: 'processing',
      message: 'Document processing started'
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
      return res.status(400).json({ error: 'Invalid URL format' });
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

export default router;
