import assert from 'node:assert/strict'
import test from 'node:test'

import type { RuntimeConfig } from '../src/config.js'
import { buildReadiness, startServer } from '../src/server.js'
import type { ChatClient } from '../src/llm-client.js'
import { CachingEmbeddingProvider } from '../src/rag/caching-embedding-provider.js'
import { EmbeddingCache } from '../src/rag/embedding-cache.js'
import type { EmbeddingProvider } from '../src/rag/embedding-provider.js'
import { LoreIndex } from '../src/rag/lore-index.js'
import { SemanticLoreSearchService } from '../src/rag/lore-search-service.js'

// Feature: ai-runtime-performance, Task 10.2 (integration)
// Validates: Requirements 2.1, 3.7, 6.2
//
// With an index loaded and the embedding cache enabled:
//   1. `/v1/lore/search` `ok:true` includes a defined `indexSignature` and the
//      snippet shape is otherwise unchanged (source/heading/text/score).
//   2. `/ready` (via buildReadiness with the loaded service signature) reports
//      `dependencies.rag.indexSignature` when the index is loaded.
//   3. A repeated identical query is served correctly with the embedding cache
//      enabled, and the inner embedding provider is invoked at most once for it.

const INDEX_SIGNATURE = 'idx_test_integration_signature'
const MATCHING_QUERY = 'village shrine'

test('runtime lore-search + ready integration: indexSignature surfaces and embedding cache serves repeats', async (t) => {
  const inner = new CountingEmbeddingProvider({ [MATCHING_QUERY]: [1, 0] })
  const cachingProvider = new CachingEmbeddingProvider(inner, new EmbeddingCache({ maxEntries: 256 }))

  const service = new SemanticLoreSearchService({
    embeddingProvider: cachingProvider,
    index: createSimpleIndex(),
    defaultTopK: 4,
    relevanceThreshold: 0.1,
    indexSignature: INDEX_SIGNATURE
  })

  const config = createRuntimeConfig()
  const server = await startServer({
    port: 0,
    config,
    chatClient: createFakeChatClient(),
    loreSearcher: service
  })
  t.after(() => server.close())

  // (1) Cold lore-search request: ok:true response carries the indexSignature and
  // the snippet shape is exactly { source, heading, text, score } (Req 2.1, 6.2).
  const firstBody = await postLoreSearch(server.url, { query: MATCHING_QUERY, topK: 1 })

  assert.equal(firstBody.ok, true)
  assert.equal(firstBody.source, 'rag')
  assert.equal(firstBody.indexSignature, INDEX_SIGNATURE)
  assert.deepEqual(firstBody.snippets, [
    {
      source: 'thanh-giong.md',
      heading: 'Đền Sóc Sơn',
      text: 'Thánh Gióng cưỡi ngựa sắt bay về trời.',
      score: 1
    }
  ])
  // Snippet shape is otherwise unchanged: no extra keys beyond the contract.
  assert.deepEqual(Object.keys(firstBody.snippets[0]).sort(), ['heading', 'score', 'source', 'text'])

  // (2) /ready reports dependencies.rag.indexSignature when the index is loaded
  // (Req 2.1, 6.2). buildReadiness drives the actual `/ready` handler.
  const readyResponse = await fetch(`${server.url}/ready`)
  const readyBody = (await readyResponse.json()) as {
    dependencies: { rag: { ready: boolean; indexSignature?: string } }
  }
  assert.equal(readyResponse.status, 200)
  assert.equal(readyBody.dependencies.rag.indexSignature, INDEX_SIGNATURE)
  // The `/ready` payload matches buildReadiness with the loaded service signature.
  assert.deepEqual(readyBody, buildReadiness(config, service.indexSignature))

  // (3) Repeated identical query is served correctly from the embedding cache.
  const secondBody = await postLoreSearch(server.url, { query: MATCHING_QUERY, topK: 1 })
  assert.deepEqual(secondBody, firstBody)

  // The embedding for this normalized query was computed at most once: the second
  // request hit the embedding cache rather than recomputing (Req 3.7).
  assert.equal(inner.countFor(MATCHING_QUERY), 1)
})

function createSimpleIndex(): LoreIndex {
  return new LoreIndex({
    dimension: 2,
    entries: [
      {
        chunk: {
          id: 'thanh-giong.md#den-soc-son',
          source: 'thanh-giong.md',
          heading: 'Đền Sóc Sơn',
          text: 'Thánh Gióng cưỡi ngựa sắt bay về trời.'
        },
        vector: [1, 0]
      },
      {
        chunk: {
          id: 'world.md#long-mach',
          source: 'world.md',
          heading: 'Long Mạch',
          text: 'Long Mạch là dòng chảy cổ.'
        },
        vector: [0, 1]
      }
    ]
  })
}

/** Counting fake inner provider; tracks how many times each text was embedded. */
class CountingEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 2
  private readonly counts = new Map<string, number>()

  constructor(private readonly vectors: Record<string, number[]>) {}

  async embedQuery(text: string): Promise<number[]> {
    this.counts.set(text, (this.counts.get(text) ?? 0) + 1)
    return this.vectors[text] ?? [0, 1]
  }

  async embedDocuments(texts: readonly string[]): Promise<readonly number[][]> {
    return texts.map((text) => this.vectors[text] ?? [0, 1])
  }

  countFor(text: string): number {
    return this.counts.get(text) ?? 0
  }
}

interface LoreSearchOkBody {
  ok: boolean
  source: string
  indexSignature?: string
  snippets: Array<{ source: string; heading: string; text: string; score: number }>
}

async function postLoreSearch(baseUrl: string, body: unknown): Promise<LoreSearchOkBody> {
  const response = await fetch(`${baseUrl}/v1/lore/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  assert.equal(response.status, 200)
  return (await response.json()) as LoreSearchOkBody
}

function createFakeChatClient(): ChatClient {
  return {
    completeChat: async () => ({ ok: true, text: 'unused' })
  }
}

function createRuntimeConfig(): RuntimeConfig {
  return {
    port: 0,
    authToken: '',
    llm: {
      baseUrl: 'http://localhost:1234/v1',
      model: 'test-model',
      apiKey: 'local-dev-key',
      requestTimeoutMs: 12000,
      reasoningEffort: 'none',
      warmupEnabled: false
    },
    rag: {
      corpusDir: 'data/lore-corpus',
      policyDir: 'data/lore-policy',
      indexFile: 'data/lore-index/lore-embedding-index.json',
      relevanceThreshold: 0.1,
      topK: 4,
      rebuildIndexOnMissing: false,
      embeddingModel: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      embeddingDimension: 384,
      embeddingCacheMax: 256
    }
  }
}
