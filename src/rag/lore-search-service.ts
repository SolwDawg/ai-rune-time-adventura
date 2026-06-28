import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { RuntimeConfig } from '../config.js'
import type { LoreSearchRequest, LoreSearchResponse } from '../contracts.js'
import { CachingEmbeddingProvider } from './caching-embedding-provider.js'
import { loadLoreCorpus } from './corpus-loader.js'
import { EmbeddingCache } from './embedding-cache.js'
import type { EmbeddingProvider } from './embedding-provider.js'
import { TransformersEmbeddingProvider } from './embedding-provider.js'
import { deserializeEmbeddingIndex, serializeEmbeddingIndex, type EmbeddingIndexEntry } from './embedding-index.js'
import { computeIndexSignature } from './index-signature.js'
import { LoreIndex } from './lore-index.js'
import { normalizeText } from './normalize.js'

export interface LoreSearcher {
  search(request: LoreSearchRequest): Promise<LoreSearchResponse>
  /** Index_Signature when an index is loaded, otherwise undefined. */
  readonly indexSignature?: string
  /** Embedding provider used by the live search path, exposed for warm-up. */
  readonly embeddingProviderForWarmup?: Pick<EmbeddingProvider, 'embedQuery'>
}

export interface SemanticLoreSearchServiceOptions {
  readonly embeddingProvider: EmbeddingProvider
  readonly index: LoreIndex | null
  readonly defaultTopK: number
  readonly relevanceThreshold: number
  readonly indexSignature?: string
}

export interface LoreSearchLogger {
  warn(message: string): void
}

export class SemanticLoreSearchService implements LoreSearcher {
  private readonly embeddingProvider: EmbeddingProvider
  private readonly index: LoreIndex | null
  private readonly defaultTopK: number
  private readonly relevanceThreshold: number
  readonly indexSignature?: string

  constructor(options: SemanticLoreSearchServiceOptions) {
    this.embeddingProvider = options.embeddingProvider
    this.index = options.index
    this.defaultTopK = options.defaultTopK
    this.relevanceThreshold = options.relevanceThreshold
    this.indexSignature = options.indexSignature
  }

  /** Exposes the live-path embedding provider so the warm-up task can pre-load it. */
  get embeddingProviderForWarmup(): Pick<EmbeddingProvider, 'embedQuery'> {
    return this.embeddingProvider
  }

  async search(request: LoreSearchRequest): Promise<LoreSearchResponse> {
    const query = normalizeText(request.query).trim()
    if (!query) {
      return this.indexSignature
        ? { ok: true, source: 'rag', snippets: [], indexSignature: this.indexSignature }
        : { ok: true, source: 'rag', snippets: [] }
    }

    if (!this.index) {
      // No index loaded => no signature available; omit it (Backend then skips caching).
      return this.indexSignature
        ? { ok: false, source: 'fallback', errorCode: 'rag-index-unavailable', indexSignature: this.indexSignature }
        : { ok: false, source: 'fallback', errorCode: 'rag-index-unavailable' }
    }

    try {
      const queryVector = await this.embeddingProvider.embedQuery(query)
      const snippets = this.index.searchVector({
        queryVector,
        topK: normalizeTopK(request.topK, this.defaultTopK),
        threshold: this.relevanceThreshold,
        storylineId: request.storylineId,
        npcId: request.npcId
      })
      return this.indexSignature
        ? { ok: true, source: 'rag', snippets, indexSignature: this.indexSignature }
        : { ok: true, source: 'rag', snippets }
    } catch {
      return { ok: false, source: 'fallback', errorCode: 'rag-provider-error' }
    }
  }
}

export async function createSemanticLoreSearchService(
  config: RuntimeConfig['rag'],
  logger: LoreSearchLogger = console
): Promise<SemanticLoreSearchService> {
  const baseProvider = new TransformersEmbeddingProvider({
    model: config.embeddingModel,
    dimension: config.embeddingDimension
  })
  const embeddingProvider: EmbeddingProvider =
    config.embeddingCacheMax > 0
      ? new CachingEmbeddingProvider(baseProvider, new EmbeddingCache({ maxEntries: config.embeddingCacheMax }))
      : baseProvider

  const loaded = loadIndexFromFile(config.indexFile, config.embeddingModel, config.embeddingDimension, logger)
  let index = loaded.index
  let indexSignature = loaded.signature

  if (!index && config.rebuildIndexOnMissing) {
    const rebuilt = await rebuildIndexWithSignature(config, baseProvider, logger)
    index = rebuilt.index
    indexSignature = rebuilt.signature
  }

  return new SemanticLoreSearchService({
    embeddingProvider,
    index,
    defaultTopK: config.topK,
    relevanceThreshold: config.relevanceThreshold,
    indexSignature
  })
}

export async function rebuildIndexFromCorpus(
  config: RuntimeConfig['rag'],
  embeddingProvider: EmbeddingProvider,
  logger: LoreSearchLogger = console
): Promise<LoreIndex | null> {
  return (await rebuildIndexWithSignature(config, embeddingProvider, logger)).index
}

async function rebuildIndexWithSignature(
  config: RuntimeConfig['rag'],
  embeddingProvider: EmbeddingProvider,
  logger: LoreSearchLogger = console
): Promise<{ index: LoreIndex | null; signature?: string }> {
  const loaded = loadLoreCorpus({ corpusDir: config.corpusDir, policyDir: config.policyDir, logger })
  const texts = loaded.chunks.map((chunk) => `${chunk.heading}\n\n${chunk.text}`)
  const vectors = await embeddingProvider.embedDocuments(texts)
  const entries: EmbeddingIndexEntry[] = loaded.chunks.map((chunk, index) => ({
    chunk,
    vector: vectors[index]
  }))

  const serialized = serializeEmbeddingIndex({ dimension: embeddingProvider.dimension, entries })
  mkdirSync(dirname(config.indexFile), { recursive: true })
  writeFileSync(config.indexFile, serialized, 'utf8')
  const signature = computeIndexSignature({
    dimension: embeddingProvider.dimension,
    embeddingModel: config.embeddingModel,
    entryCount: entries.length,
    indexFileBytes: serialized
  })
  return { index: new LoreIndex({ dimension: embeddingProvider.dimension, entries }), signature }
}

function loadIndexFromFile(
  indexFile: string,
  embeddingModel: string,
  expectedDimension: number,
  logger: LoreSearchLogger
): { index: LoreIndex | null; signature?: string } {
  if (!existsSync(indexFile)) {
    return { index: null }
  }

  const fileBytes = readFileSync(indexFile, 'utf8')
  const result = deserializeEmbeddingIndex(fileBytes)
  if (!result.ok) {
    logger.warn(`RAG index unavailable: ${result.reason}`)
    return { index: null }
  }

  if (result.index.dimension !== expectedDimension) {
    logger.warn(`RAG index unavailable: expected dimension ${expectedDimension}, got ${result.index.dimension}`)
    return { index: null }
  }

  // Compute the Index_Signature from the already-read index file (Req 2.1/2.2/5.3).
  const signature = computeIndexSignature({
    dimension: result.index.dimension,
    embeddingModel,
    entryCount: result.index.entries.length,
    indexFileBytes: fileBytes
  })

  return { index: new LoreIndex(result.index), signature }
}

function normalizeTopK(value: number | undefined, fallback: number): number {
  if (!value || !Number.isSafeInteger(value) || value <= 0) {
    return fallback
  }

  return Math.min(value, 20)
}
