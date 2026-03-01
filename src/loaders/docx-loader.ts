import mammoth from 'mammoth';

export interface DOCXDocument {
  text: string;
  metadata: {
    wordCount: number;
  };
}

/**
 * Extract text from DOCX file
 * @param filePath - Path to DOCX file
 * @returns Document text and metadata
 */
export async function loadDOCX(filePath: string): Promise<DOCXDocument> {
  const result = await mammoth.extractRawText({ path: filePath });

  const text = result.value.trim();
  const wordCount = text.split(/\s+/).length;

  if (result.messages.length > 0) {
    console.warn('DOCX parsing warnings:', result.messages);
  }

  return {
    text,
    metadata: {
      wordCount
    }
  };
}
