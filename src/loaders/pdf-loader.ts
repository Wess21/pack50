import { readFile } from "fs/promises";
import { PDFParse } from "pdf-parse";

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

  // pdf-parse 2.x uses class-based API
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  
  let infoResult;
  try {
    infoResult = await parser.getInfo();
  } catch (e) {
    infoResult = { info: {}, total: textResult.total || 1 };
  }

  // Extract text from all pages
  const pages: PDFPage[] = (textResult.pages || []).map(page => ({
    pageNumber: page.num,
    text: page.text || ""
  }));

  // Fallback if pages aren't cleanly extracted
  if (pages.length === 0 && textResult.text) {
    pages.push({
      pageNumber: 1,
      text: textResult.text,
    });
  }

  const totalPages = textResult.total || 1;

  return {
    pages,
    metadata: {
      title: infoResult.info?.Title,
      author: infoResult.info?.Author,
      totalPages: totalPages,
    },
  };
}
