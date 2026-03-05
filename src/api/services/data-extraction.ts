import { logger } from '../../utils/logger.js';
import { createLLMProvider } from '../../services/llm/provider-factory.js';

// Regular expressions for structured data extraction
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Extracted data structure
 */
export interface ExtractedData {
  name?: string;
  email?: string;
  phone?: string;
}

/**
 * Extract email address from message using regex
 */
function extractEmail(message: string): string | undefined {
  // Split message into words and test each against email regex
  const words = message.split(/\s+/);
  for (const word of words) {
    if (EMAIL_REGEX.test(word)) {
      return word;
    }
  }
  return undefined;
}


/**
 * Extract name from message using LLM or regex fallback
 * Tries LLM first using configured provider, falls back to regex patterns
 */
async function extractName(message: string): Promise<string | undefined> {
  // Try LLM using configured provider
  try {
    logger.info('Attempting LLM-based name extraction using configured provider...');
    const provider = await createLLMProvider();

    const userPrompt = `Extract the person's name from this message. They might explicitly introduce themselves (e.g. "Меня зовут Дмитрий", "Я Андрей") or simply type their name (e.g. "Дмитрий", "Валера"). Do NOT extract names of companies, products, or unrelated conversational words. If there is a person's name present, return ONLY the name text. If no clear name is present, return 'NONE'.\n\nMessage: "${message}"`;

    const response = await provider.generateResponse({
      messages: [{ role: 'user', content: userPrompt }],
      systemPrompt: 'You are a strict data extractor.',
      maxTokens: 50,
      temperature: 0.3,
    });

    const extractedText = response.content.trim();
    // Only accept if model returned something that's not NONE and looks like a real name
    if (extractedText && extractedText !== 'NONE' && extractedText.length > 1 && extractedText.length < 60) {
      logger.info('Name extracted via LLM', { name: extractedText });
      return extractedText;
    }
  } catch (error) {
    logger.warn('Failed to extract name via LLM, falling back to regex', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fall through to regex extraction
  }

  // Fallback: regex-based name extraction
  logger.info('Using regex fallback for name extraction');
  const patterns = [
    // "Меня зовут Иван", "Я Петр", "Имя: Сергей"
    /(?:меня зовут|я|имя:?)\s+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)*)/i,
    // Standalone full name: "Иван Петров"
    /^([А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+)$/i,
    // Single name or name with a number/phone following: "Дмитрий", "Дмитрий 892133"
    /^([А-ЯЁA-Z][а-яёa-z]{2,})(?:\s+[\d\-\+() ]+)?$/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      logger.info('Name extracted via regex', { name });
      return name;
    }
  }

  logger.info('No name found in message');
  return undefined;
}

/**
 * Extract data from user message using regex and LLM
 *
 * Strategy:
 * 1. Extract email if missing (regex)
 * 2. Extract phone if missing (regex)
 * 3. Extract name via LLM if missing and no email/phone detected
 *
 * @param message - User's message text
 * @param existingData - Already extracted data to avoid re-extraction
 * @returns Partial extracted data (fields that were found)
 */
export async function extractDataFromMessage(
  message: string,
  existingData: Partial<ExtractedData> = {}
): Promise<Partial<ExtractedData>> {
  logger.info('Entering extractDataFromMessage', { message, existingData });
  const extracted: Partial<ExtractedData> = {};

  // Extract email if not already present
  if (!existingData.email) {
    const email = extractEmail(message);
    if (email) {
      extracted.email = email;
      logger.debug('Email extracted', { email });
    }
  }


  // Extract name if missing
  // We remove the condition that completely skipped name extraction if a phone was present,
  // since users commonly say "Дмитрий 89213304533" which would cause the name to be dropped.
  // Extract name if missing
  if (!existingData.name) {
    logger.info('Attempting to extract name...');
    const name = await extractName(message);
    if (name) {
      extracted.name = name;
      logger.info('Name extracted and updated', { name });
    }
  }

  logger.info('Extraction complete', { extracted });
  return extracted;
}
