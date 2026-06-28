export interface EmbeddingCacheOptions {
  readonly maxEntries: number
}

/**
 * Bounded least-recently-used cache mapping a normalized query string to its
 * embedding vector. Backed by a `Map`, which preserves insertion order, so the
 * first key is always the least-recently-used entry. `get` re-inserts a hit to
 * mark it most-recently-used; `set` evicts the oldest entry while the size exceeds
 * `maxEntries` (clamped to >= 1).
 */
export class EmbeddingCache {
  private readonly map = new Map<string, number[]>()
  private readonly maxEntries: number

  constructor(options: EmbeddingCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries)
  }

  get(key: string): number[] | undefined {
    const value = this.map.get(key)
    if (value === undefined) {
      return undefined
    }

    // Re-insert to mark most-recently-used.
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: number[]): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    }
    this.map.set(key, value)

    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string // least-recently-used
      this.map.delete(oldest)
    }
  }

  get size(): number {
    return this.map.size
  }
}
