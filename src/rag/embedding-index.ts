import type { LoreCorpusChunk } from './corpus-loader.js'

export interface EmbeddingIndexEntry {
  readonly chunk: LoreCorpusChunk
  readonly vector: readonly number[]
}

export interface EmbeddingIndexData {
  readonly dimension: number
  readonly entries: readonly EmbeddingIndexEntry[]
}

interface SerializedEmbeddingIndex {
  readonly version: 1
  readonly dimension: number
  readonly entries: readonly EmbeddingIndexEntry[]
}

export type DeserializeEmbeddingIndexResult =
  | { readonly ok: true; readonly index: EmbeddingIndexData }
  | { readonly ok: false; readonly reason: string }

export function serializeEmbeddingIndex(index: EmbeddingIndexData): string {
  assertValidIndex(index)
  const document: SerializedEmbeddingIndex = {
    version: 1,
    dimension: index.dimension,
    entries: index.entries
  }

  return `${JSON.stringify(document, null, 2)}\n`
}

export function deserializeEmbeddingIndex(value: string): DeserializeEmbeddingIndexResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  if (!isSerializedEmbeddingIndex(parsed)) {
    return { ok: false, reason: 'invalid-schema' }
  }

  try {
    assertValidIndex(parsed)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid-index' }
  }

  return {
    ok: true,
    index: {
      dimension: parsed.dimension,
      entries: parsed.entries
    }
  }
}

function assertValidIndex(index: EmbeddingIndexData): void {
  if (!Number.isSafeInteger(index.dimension) || index.dimension <= 0) {
    throw new Error('invalid-dimension')
  }

  for (const entry of index.entries) {
    if (entry.vector.length !== index.dimension || entry.vector.some((value) => !Number.isFinite(value))) {
      throw new Error('dimension-mismatch')
    }
  }
}

function isSerializedEmbeddingIndex(value: unknown): value is SerializedEmbeddingIndex {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SerializedEmbeddingIndex>
  return candidate.version === 1 && typeof candidate.dimension === 'number' && Array.isArray(candidate.entries)
}
