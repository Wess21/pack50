import * as pdfParse from 'pdf-parse';
import { readFile } from 'fs/promises';

// pdf-parse exports as CommonJS module
const pdf = (pdfParse as any).default || pdfParse;

export interface PDFPage {
  pageNumber: number;
  text: string;
}

export interface PDFDocument {
  pages: PDFPage[];
  metadata: {
    title?: string;
    author?: string;
    totalPages: number;
  };
}

/**
 * Load PDF and extract text by page
 * @param filePath - Path to PDF file
 * @returns Structured document with page-level text
 */
export async function loadPDF(filePath: string): Promise<PDFDocument> {
  const buffer = await readFile(filePath);
  const data = await pdf(buffer);

  // pdf-parse provides full text, we need to extract by page
  // Use render_page callback to capture per-page text
  const pages: PDFPage[] = [];

  const pdfData = await pdf(buffer, {
    pagerender: async (pageData: any) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();

      pages.push({
        pageNumber: pageData.pageNumber,
        text
      });

      return '';  // Required return for pagerender
    }
  });

  return {
    pages: pages.length > 0 ? pages : [{
      pageNumber: 1,
      text: data.text  // Fallback to full text if page parsing fails
    }],
    metadata: {
      title: data.info?.Title,
      author: data.info?.Author,
      totalPages: data.numpages
    }
  };
}
