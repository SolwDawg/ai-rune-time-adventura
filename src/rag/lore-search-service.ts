import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { RuntimeConfig } from '../config.js'
import type { LoreSearchRequest, LoreSearchResponse } from '../contracts.js'
import { loadLoreCorpus } from './corpus-loader.js'
import type { EmbeddingProvider } from './embedding-provider.js'
import { TransformersEmbeddingProvider } from './embedding-provider.js'
import { deserializeEmbeddingIndex, serializeEmbeddingIndex, type EmbeddingIndexEntry } from './embedding-index.js'
import { LoreIndex } from './lore-index.js'
import { normalizeText } from './normalize.js'

export interface LoreSearcher {
  search(request: LoreSearchRequest): Promise<LoreSearchResponse>
}

export interface SemanticLoreSearchServiceOptions {
  readonly embeddingProvider: EmbeddingProvider
  readonly index: LoreIndex | null
  readonly defaultTopK: number
  readonly relevanceThreshold: number
}

export interface LoreSearchLogger {
  warn(message: string): void
}

export class SemanticLoreSearchService implements LoreSearcher {
  private readonly embeddingProvider: EmbeddingProvider
  private readonly index: LoreIndex | null
  private readonly defaultTopK: number
  private readonly relevanceThreshold: number

  constructor(options: SemanticLoreSearchServiceOptions) {
    this.embeddingProvider = options.embeddingProvider
    this.index = options.index
    this.defaultTopK = options.defaultTopK
    this.relevanceThreshold = options.relevanceThreshold
  }

  async search(request: LoreSearchRequest): Promise<LoreSearchResponse> {
    const query = normalizeText(request.query).trim()
    if (!query) {
      return { ok: true, source: 'rag', snippets: [] }
    }

    if (!this.index) {
      return { ok: false, source: 'fallback', errorCode: 'rag-index-unavailable' }
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
      return { ok: true, source: 'rag', snippets }
    } catch {
      return { ok: false, source: 'fallback', errorCode: 'rag-provider-error' }
    }
  }
}

export async function createSemanticLoreSearchService(
  config: RuntimeConfig['rag'],
  logger: LoreSearchLogger = console
): Promise<SemanticLoreSearchService> {
  const embeddingProvider = new TransformersEmbeddingProvider({
    model: config.embeddingModel,
    dimension: config.embeddingDimension
  })
  let index = loadIndexFromFile(config.indexFile, config.embeddingDimension, logger)

  if (!index && config.rebuildIndexOnMissing) {
    index = await rebuildIndexFromCorpus(config, embeddingProvider, logger)
  }

  return new SemanticLoreSearchService({
    embeddingProvider,
    index,
    defaultTopK: config.topK,
    relevanceThreshold: config.relevanceThreshold
  })
}

export async function rebuildIndexFromCorpus(
  config: RuntimeConfig['rag'],
  embeddingProvider: EmbeddingProvider,
  logger: LoreSearchLogger = console
): Promise<LoreIndex | null> {
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
  return new LoreIndex({ dimension: embeddingProvider.dimension, entries })
}

function loadIndexFromFile(
  indexFile: string,
  expectedDimension: number,
  logger: LoreSearchLogger
): LoreIndex | null {
  if (!existsSync(indexFile)) {
    return null
  }

  const result = deserializeEmbeddingIndex(readFileSync(indexFile, 'utf8'))
  if (!result.ok) {
    logger.warn(`RAG index unavailable: ${result.reason}`)
    return null
  }

  if (result.index.dimension !== expectedDimension) {
    logger.warn(`RAG index unavailable: expected dimension ${expectedDimension}, got ${result.index.dimension}`)
    return null
  }

  return new LoreIndex(result.index)
}

function normalizeTopK(value: number | undefined, fallback: number): number {
  if (!value || !Number.isSafeInteger(value) || value <= 0) {
    return fallback
  }

  return Math.min(value, 20)
}
