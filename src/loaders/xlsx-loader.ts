import XLSX from 'xlsx';
import { logger } from '../utils/logger.js';

export interface XLSXDocument {
    text: string;
    sheets: string[];
}

/**
 * Load and extract text from an Excel file (xlsx/xls/csv)
 * Each sheet becomes a section in the output text
 */
export async function loadXLSX(filePath: string): Promise<XLSXDocument> {
    logger.debug('Loading XLSX file', { filePath });

    const workbook = XLSX.readFile(filePath, { type: 'file', cellDates: true });
    const sheetNames = workbook.SheetNames;

    const sections: string[] = [];

    for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        // Convert sheet to CSV-like text, preserving values
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) {
            sections.push(`=== Лист: ${sheetName} ===\n${csv}`);
        }
    }

    const text = sections.join('\n\n');

    logger.debug('XLSX loaded', { sheets: sheetNames.length, textLength: text.length });

    return { text, sheets: sheetNames };
}
