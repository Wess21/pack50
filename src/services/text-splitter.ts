export interface TextChunk {
  text: string;
  metadata: {
    startIndex: number;
    endIndex: number;
    chunkIndex: number;
  };
}

export interface TextSplitterOptions {
  chunkSize: number;
  chunkOverlap: number;
  separators: string[];
}

/**
 * Recursive character text splitter
 * Splits on semantic boundaries (paragraphs → sentences → words)
 */
export class RecursiveCharacterTextSplitter {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[];

  constructor(options: TextSplitterOptions) {
    this.chunkSize = options.chunkSize;
    this.chunkOverlap = options.chunkOverlap;
    this.separators = options.separators;
  }

  /**
   * Split text into chunks with overlap
   */
  splitText(text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    let chunkIndex = 0;

    this._splitTextRecursive(text, 0, chunks, chunkIndex);

    return chunks;
  }

  private _splitTextRecursive(
    text: string,
    startOffset: number,
    chunks: TextChunk[],
    chunkIndex: number
  ): number {
    if (text.length <= this.chunkSize) {
      // Base case: text fits in one chunk
      if (text.trim().length > 0) {
        chunks.push({
          text: text.trim(),
          metadata: {
            startIndex: startOffset,
            endIndex: startOffset + text.length,
            chunkIndex
          }
        });
        return chunkIndex + 1;
      }
      return chunkIndex;
    }

    // Try each separator in order
    for (const separator of this.separators) {
      if (text.includes(separator)) {
        const parts = text.split(separator);
        let currentChunk = '';
        let currentStart = startOffset;

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const withSeparator = i < parts.length - 1 ? part + separator : part;

          if ((currentChunk + withSeparator).length <= this.chunkSize) {
            currentChunk += withSeparator;
          } else {
            // Flush current chunk
            if (currentChunk.trim().length > 0) {
              chunks.push({
                text: currentChunk.trim(),
                metadata: {
                  startIndex: currentStart,
                  endIndex: currentStart + currentChunk.length,
                  chunkIndex
                }
              });
              chunkIndex++;
            }

            // Start new chunk with overlap
            const overlapStart = Math.max(0, currentChunk.length - this.chunkOverlap);
            currentChunk = currentChunk.substring(overlapStart) + withSeparator;
            currentStart = currentStart + overlapStart;
          }
        }

        // Flush remaining
        if (currentChunk.trim().length > 0) {
          chunks.push({
            text: currentChunk.trim(),
            metadata: {
              startIndex: currentStart,
              endIndex: currentStart + currentChunk.length,
              chunkIndex
            }
          });
        }

        return chunkIndex;
      }
    }

    // Fallback: hard split at chunkSize
    for (let i = 0; i < text.length; i += this.chunkSize - this.chunkOverlap) {
      const chunk = text.substring(i, i + this.chunkSize);
      if (chunk.trim().length > 0) {
        chunks.push({
          text: chunk.trim(),
          metadata: {
            startIndex: startOffset + i,
            endIndex: startOffset + i + chunk.length,
            chunkIndex
          }
        });
        chunkIndex++;
      }
    }

    return chunkIndex;
  }
}
