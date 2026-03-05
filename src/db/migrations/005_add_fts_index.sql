-- Migration: Add generated column and GIN index for Full Text Search

-- 1. Add generated tsvector column based on content
ALTER TABLE document_chunks 
ADD COLUMN IF NOT EXISTS content_tsvector tsvector 
GENERATED ALWAYS AS (to_tsvector('russian', coalesce(content, ''))) STORED;

-- 2. Create GIN index on this generated column to make FTS queries instantaneous
CREATE INDEX IF NOT EXISTS idx_document_chunks_fts 
ON document_chunks USING GIN(content_tsvector);
