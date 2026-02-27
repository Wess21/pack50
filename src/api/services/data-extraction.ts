import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// Regular expressions for structured data extraction
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

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
 * Extract phone number from message using regex
 */
function extractPhone(message: string): string | undefined {
  // Remove common separators and test against phone regex
  const cleaned = message.replace(/[\s\-\(\)\.]/g, '');
  if (PHONE_REGEX.test(cleaned)) {
    return message.trim();
  }

  // Try finding phone-like pattern in message
  const phonePattern = /[\+]?[0-9]{1,3}[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}/;
  const match = message.match(phonePattern);
  if (match && match[0].replace(/\D/g, '').length >= 7) {
    return match[0].trim();
  }

  return undefined;
}

/**
 * Extract name from message using Claude API
 * Handles complex patterns (Jr., titles, Cyrillic names) that regex can't handle
 */
async function extractName(message: string): Promise<string | undefined> {
  try {
    logger.debug('Extracting name via LLM', { message });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `Extract the person's name from this message. Return only the name, or 'NONE' if no name is present.\n\nMessage: "${message}"`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const extractedText = content.text.trim();
      if (extractedText && extractedText !== 'NONE' && extractedText.length > 0) {
        logger.debug('Name extracted', { name: extractedText });
        return extractedText;
      }
    }

    return undefined;
  } catch (error) {
    logger.error('Failed to extract name via LLM', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
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
  const extracted: Partial<ExtractedData> = {};

  // Extract email if not already present
  if (!existingData.email) {
    const email = extractEmail(message);
    if (email) {
      extracted.email = email;
      logger.debug('Email extracted', { email });
    }
  }

  // Extract phone if not already present
  if (!existingData.phone) {
    const phone = extractPhone(message);
    if (phone) {
      extracted.phone = phone;
      logger.debug('Phone extracted', { phone });
    }
  }

  // Extract name via LLM if not already present and no email/phone detected
  // (Avoid LLM call if message contains structured data - likely not a name)
  if (!existingData.name && !extracted.email && !extracted.phone) {
    const name = await extractName(message);
    if (name) {
      extracted.name = name;
    }
  }

  return extracted;
}
