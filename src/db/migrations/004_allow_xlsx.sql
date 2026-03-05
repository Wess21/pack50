-- Migration: Allow xlsx and xls in documents_source_type_check constraint

-- 1. Drop the existing constraint
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_type_check;

-- 2. Add the new constraint with xlsx and xls
ALTER TABLE documents ADD CONSTRAINT documents_source_type_check 
CHECK (source_type IN ('pdf', 'docx', 'txt', 'url', 'xlsx', 'xls'));
