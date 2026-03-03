-- Migration: Enhanced document management with metadata and statistics
-- Adds document tracking table, metadata fields, and usage statistics

-- Create documents table to track uploaded files
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL UNIQUE,  -- Original filename or URL
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('pdf', 'docx', 'txt', 'url')),
  title TEXT,  -- User-friendly title
  description TEXT,  -- Document description
  tags TEXT[],  -- Searchable tags
  priority INTEGER DEFAULT 0,  -- Search priority weight (higher = more important)
  chunk_count INTEGER DEFAULT 0,  -- Number of chunks from this document
  total_size_bytes BIGINT,  -- Original file size
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'processing', 'failed')),
  upload_date TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,  -- Last time document was used in RAG response
  usage_count INTEGER DEFAULT 0,  -- How many times chunks from this doc were retrieved
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add source column to document_chunks if not exists (for backwards compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_chunks' AND column_name = 'source'
  ) THEN
    ALTER TABLE document_chunks ADD COLUMN source TEXT;
  END IF;
END $$;

-- Create index on document_chunks.source for fast lookup
CREATE INDEX IF NOT EXISTS idx_document_chunks_source ON document_chunks(source);

-- Create trigger for documents updated_at
DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Migrate existing document_chunks to documents table
INSERT INTO documents (source, source_type, chunk_count, upload_date)
SELECT
  COALESCE(metadata->>'source', 'unknown') as source,
  CASE
    WHEN COALESCE(metadata->>'source', '') LIKE '%.pdf' THEN 'pdf'
    WHEN COALESCE(metadata->>'source', '') LIKE '%.docx' THEN 'docx'
    WHEN COALESCE(metadata->>'source', '') LIKE 'http%' THEN 'url'
    ELSE 'txt'
  END as source_type,
  COUNT(*) as chunk_count,
  MIN(created_at) as upload_date
FROM document_chunks
WHERE metadata->>'source' IS NOT NULL
GROUP BY metadata->>'source'
ON CONFLICT (source) DO UPDATE
SET chunk_count = EXCLUDED.chunk_count;

-- Update document_chunks.source from metadata for existing records
UPDATE document_chunks
SET source = metadata->>'source'
WHERE source IS NULL AND metadata->>'source' IS NOT NULL;
