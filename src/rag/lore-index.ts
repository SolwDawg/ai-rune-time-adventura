import type { LoreSnippet } from '../contracts.js'
import type { LoreCorpusChunk } from './corpus-loader.js'
import type { EmbeddingIndexData, EmbeddingIndexEntry } from './embedding-index.js'

export interface LoreIndexSearchOptions {
  readonly queryVector: readonly number[]
  readonly topK: number
  readonly threshold: number
  readonly storylineId?: string
  readonly npcId?: string
}

export class LoreIndex {
  readonly dimension: number
  private readonly entries: readonly EmbeddingIndexEntry[]

  constructor(index: EmbeddingIndexData) {
    if (!Number.isSafeInteger(index.dimension) || index.dimension <= 0) {
      throw new Error('Lore index dimension must be a positive integer.')
    }

    for (const entry of index.entries) {
      if (entry.vector.length !== index.dimension) {
        throw new Error(`Lore index entry ${entry.chunk.id} has incompatible vector dimension.`)
      }
    }

    this.dimension = index.dimension
    this.entries = index.entries
  }

  searchVector(options: LoreIndexSearchOptions): LoreSnippet[] {
    if (options.queryVector.length !== this.dimension || options.topK <= 0) {
      return []
    }

    return this.entries
      .filter((entry) => matchesScope(entry.chunk, options.storylineId, options.npcId))
      .map((entry) => ({
        source: entry.chunk.source,
        heading: entry.chunk.heading,
        text: entry.chunk.text,
        score: cosineSimilarity(options.queryVector, entry.vector),
        // Propagate the chunk's quest gate so the backend can apply its
        // Unlocked_Content (anti-spoiler) filter. Omitted for non-gated chunks.
        ...(entry.chunk.questId ? { questId: entry.chunk.questId } : {})
      }))
      .filter((result) => result.score >= options.threshold)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.source.localeCompare(b.source) ||
          a.heading.localeCompare(b.heading) ||
          a.text.localeCompare(b.text)
      )
      .slice(0, options.topK)
  }
}

/**
 * Storyline/NPC scope guard for lore retrieval.
 *
 * Rules (Requirements 1.3, 1.4, 1.5, 2.1):
 * - When the request carries a `storylineId`, any chunk tagged with a DIFFERENT
 *   `storylineId` is excluded (no cross-storyline leakage).
 * - A chunk with no `storylineId` is Shared_Lore and is always kept regardless of
 *   the request `storylineId`.
 * - When the request carries an `npcId`, any chunk tagged with a DIFFERENT `npcId`
 *   is excluded; chunks with no `npcId` are kept.
 *
 * Behavior is intentionally unchanged from the prior implementation (a request
 * without `storylineId` still matches every chunk); the missing-storyline gate
 * is enforced upstream by the backend orchestrator, not here.
 */
function matchesScope(chunk: LoreCorpusChunk, storylineId: string | undefined, npcId: string | undefined): boolean {
  if (storylineId && chunk.storylineId && chunk.storylineId !== storylineId) {
    return false
  }

  if (npcId && chunk.npcId && chunk.npcId !== npcId) {
    return false
  }

  return true
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0
  }

  const score = dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
  return Math.max(-1, Math.min(1, Number(score.toFixed(6))))
}
