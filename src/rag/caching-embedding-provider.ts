import type { EmbeddingProvider } from './embedding-provider.js'
import type { EmbeddingCache } from './embedding-cache.js'

interface CacheLogger {
  warn(message: string): void
}

/**
 * Decorator over an {@link EmbeddingProvider} that caches query embeddings in a
 * bounded {@link EmbeddingCache}. It implements `EmbeddingProvider` so it drops
 * into `SemanticLoreSearchService` unchanged.
 *
 * Fail-safe: any cache `get`/`set` error is caught, logged (category/outcome
 * only), and falls back to live computation. `embedQuery` never rejects because
 * of a cache error.
 */
export class CachingEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly cache: EmbeddingCache,
    private readonly logger: CacheLogger = console
  ) {
    this.dimension = inner.dimension
  }

  // Receives the ALREADY-normalized query from SemanticLoreSearchService; does
  // not re-normalize (the live path and the cache share one normalization).
  async embedQuery(text: string): Promise<number[]> {
    try {
      const hit = this.cache.get(text)
      if (hit !== undefined) {
        return hit
      }
    } catch {
      this.logger.warn('[embeddingCache] read failed; computing live')
    }

    const vector = await this.inner.embedQuery(text)

    try {
      this.cache.set(text, vector)
    } catch {
      this.logger.warn('[embeddingCache] write failed')
    }

    return vector
  }

  // The index-build path is not cached.
  embedDocuments(texts: readonly string[]): Promise<readonly number[][]> {
    return this.inner.embedDocuments(texts)
  }
}
