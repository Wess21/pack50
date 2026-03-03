import { readFile } from 'fs/promises';

export interface TXTDocument {
  text: string;
  metadata: {
    filename: string;
  };
}

/**
 * Load plain text file
 * @param filePath - Path to TXT file
 * @returns Text content
 */
export async function loadTXT(filePath: string, filename: string): Promise<TXTDocument> {
  const text = await readFile(filePath, 'utf-8');

  return {
    text: text.trim(),
    metadata: {
      filename
    }
  };
}
