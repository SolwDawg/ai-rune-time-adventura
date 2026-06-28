import { createHash } from 'node:crypto'

export interface IndexSignatureInput {
  readonly dimension: number
  readonly embeddingModel: string
  readonly entryCount: number
  readonly indexFileBytes: Buffer | string // raw serialized index content
}

/**
 * Computes a stable Index_Signature from index-affecting state. The signature is
 * equal iff dimension, embedding model, entry count, and serialized index bytes are
 * all equal; any change to corpus content (changed bytes), dimension, or embedding
 * model yields a different signature. Fields are null-separated so a change in one
 * field can never be reconstructed as a change in an adjacent field.
 */
export function computeIndexSignature(input: IndexSignatureInput): string {
  const hash = createHash('sha256')
    .update(String(input.dimension))
    .update('\u0000')
    .update(input.embeddingModel)
    .update('\u0000')
    .update(String(input.entryCount))
    .update('\u0000')
    .update(input.indexFileBytes)
    .digest('hex')
  return `idx_${hash.slice(0, 32)}`
}
