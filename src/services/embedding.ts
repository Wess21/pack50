import { pipeline, env } from '@xenova/transformers';

// Configure cache directory for model storage
env.cacheDir = './.cache/transformers';

let embeddingPipeline: any = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;

/**
 * Initialize embedding pipeline (lazy load on first use)
 * Model downloads to cache on first run (~22MB)
 */
async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    console.log(`Loading embedding model: ${MODEL_NAME}...`);
    embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME);
    console.log('Embedding model loaded successfully');
  }
  return embeddingPipeline;
}

/**
 * Generate embedding for single text
 * @param text - Input text to embed
 * @returns 384-dimensional embedding vector as number[]
 */
export async function embedText(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot embed empty text');
  }

  const pipeline = await getEmbeddingPipeline();

  // Yield to the event loop right before executing CPU-heavy Xenova pipeline
  // This ensures concurrent users' HTTP requests and database keep-alives can process!
  await new Promise<void>(resolve => setImmediate(resolve));

  // Generate embedding
  const output = await pipeline(text, {
    pooling: 'mean',      // Mean pooling over token embeddings
    normalize: true       // L2 normalization for cosine similarity
  });

  // Extract embedding array from tensor
  const embedding = Array.from(output.data) as number[];

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}`
    );
  }

  return embedding;
}

/**
 * Generate embeddings for multiple texts (batch processing)
 * @param texts - Array of input texts
 * @returns Array of 384-dimensional embeddings
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const pipeline = await getEmbeddingPipeline();
  const results: number[][] = [];
  const YIELD_EVERY = 10;   // yield event loop every N embeddings

  for (let i = 0; i < texts.length; i++) {
    const output = await pipeline(texts[i], {
      pooling: 'mean',
      normalize: true
    });
    results.push(Array.from(output.data) as number[]);

    // Yield to event loop periodically so HTTP requests can be served
    // during long document processing (e.g. 789-chunk XLSX files)
    if (i > 0 && i % YIELD_EVERY === 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  return results;
}


/**
 * Preload embedding model during application startup
 * Call this in src/index.ts after database initialization
 */
export async function preloadEmbeddingModel(): Promise<void> {
  await getEmbeddingPipeline();
}

export const EmbeddingService = {
  embedText,
  embedBatch,
  preloadEmbeddingModel,
  EMBEDDING_DIMENSIONS
};
