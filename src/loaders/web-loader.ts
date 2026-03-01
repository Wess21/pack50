import axios from 'axios';
import * as cheerio from 'cheerio';

export interface WebDocument {
  text: string;
  metadata: {
    url: string;
    title?: string;
    extractedAt: Date;
  };
}

/**
 * Extract main content from URL using cheerio
 * Removes scripts, styles, navigation, ads (best-effort heuristics)
 * @param url - URL to scrape
 * @returns Extracted text content
 */
export async function loadURL(url: string): Promise<WebDocument> {
  // Fetch HTML
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Pack50Bot/1.0'
    },
    timeout: 10000,  // 10 second timeout
    maxRedirects: 5
  });

  const html = response.data;
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, nav, header, footer, aside, iframe, noscript').remove();

  // Extract title
  const title = $('title').text() || $('h1').first().text();

  // Extract main content (prioritize semantic HTML)
  let text = '';

  const mainContent = $('main, article, [role="main"]');
  if (mainContent.length > 0) {
    text = mainContent.text();
  } else {
    // Fallback to body
    text = $('body').text();
  }

  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')  // Collapse multiple spaces
    .replace(/\n+/g, '\n') // Collapse multiple newlines
    .trim();

  if (text.length < 100) {
    throw new Error(`Insufficient content extracted from ${url} (${text.length} chars)`);
  }

  return {
    text,
    metadata: {
      url,
      title,
      extractedAt: new Date()
    }
  };
}
