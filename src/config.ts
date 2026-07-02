export interface RuntimeConfig {
  readonly host: string
  readonly port: number
  readonly authToken: string
  readonly llm: {
    readonly baseUrl: string
    readonly model: string
    readonly apiKey: string
    readonly requestTimeoutMs: number
    readonly reasoningEffort: string
    readonly warmupEnabled: boolean
    readonly logPayloadsEnabled: boolean
  }
  readonly rag: {
    readonly corpusDir: string
    readonly policyDir: string
    readonly indexFile: string
    readonly relevanceThreshold: number
    readonly topK: number
    readonly rebuildIndexOnMissing: boolean
    readonly embeddingModel: string
    readonly embeddingDimension: number
    readonly embeddingCacheMax: number
  }
}

export function parseRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  return {
    host: parseHost(env.AI_RUNTIME_HOST),
    port: parsePositiveInt(env.AI_RUNTIME_PORT, 3100),
    authToken: env.AI_RUNTIME_AUTH_TOKEN || '',
    llm: {
      baseUrl: trimTrailingSlash(env.AI_LLM_BASE_URL || 'http://localhost:1234/v1'),
      model: env.AI_LLM_MODEL || '',
      apiKey: env.AI_LLM_API_KEY || 'local-dev-key',
      requestTimeoutMs: parsePositiveInt(env.AI_LLM_TIMEOUT_MS, 12000),
      // Controls chain-of-thought for reasoning models (e.g. Gemma 4 QAT). The
      // default "none" disables thinking so short dialogue/assessment outputs stay
      // fast; set to a model-supported level (e.g. "low") to re-enable reasoning.
      reasoningEffort: env.AI_LLM_REASONING_EFFORT || 'none',
      // Gates the optional startup LLM warm-up probe. Embedding warm-up needs no
      // flag; it runs whenever RAG is configured.
      warmupEnabled: parseBoolean(env.AI_LLM_WARMUP_ENABLED, false),
      // Verbose provider payload tracing for local debugging. This can include
      // prompts/player text, so keep it disabled outside focused diagnostics.
      logPayloadsEnabled: parseBoolean(env.AI_LLM_LOG_PAYLOADS, false)
    },
    rag: {
      corpusDir: env.RAG_CORPUS_DIR || 'data/lore-corpus',
      policyDir: env.RAG_POLICY_DIR || 'data/lore-policy',
      indexFile: env.RAG_INDEX_FILE || 'data/lore-index/lore-embedding-index.json',
      relevanceThreshold: parseThreshold(env.RAG_RELEVANCE_THRESHOLD, 0.2),
      topK: parsePositiveInt(env.RAG_TOP_K, 4),
      rebuildIndexOnMissing: parseBoolean(env.RAG_REBUILD_INDEX_ON_MISSING, false),
      embeddingModel: env.RAG_EMBEDDING_MODEL || 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      embeddingDimension: parsePositiveInt(env.RAG_EMBEDDING_DIMENSION, 384),
      // Max query-embedding LRU entries. Default 256; an explicit "0" disables the
      // cache (parsePositiveInt rejects 0, so 0 is handled here before falling back).
      embeddingCacheMax: env.RAG_EMBEDDING_CACHE_MAX?.trim() === '0' ? 0 : parsePositiveInt(env.RAG_EMBEDDING_CACHE_MAX, 256)
    }
  }
}

function parseHost(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed || '127.0.0.1'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseThreshold(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback
  }

  return value.toLowerCase() === 'true'
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
