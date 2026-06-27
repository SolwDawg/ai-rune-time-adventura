import assert from 'node:assert/strict'
import test from 'node:test'

import type { EmbeddingProvider } from '../src/rag/embedding-provider.js'
import { LoreIndex } from '../src/rag/lore-index.js'
import { SemanticLoreSearchService } from '../src/rag/lore-search-service.js'

test('SemanticLoreSearchService returns empty results for whitespace query without embedding call', async () => {
  const provider = createFakeEmbeddingProvider({ 'unused': [1, 0] })
  const service = new SemanticLoreSearchService({
    embeddingProvider: provider,
    index: createSimpleIndex(),
    defaultTopK: 4,
    relevanceThreshold: 0.1
  })

  const result = await service.search({ query: '   ' })

  assert.deepEqual(result, { ok: true, source: 'rag', snippets: [] })
  assert.equal(provider.queryCalls, 0)
})

test('SemanticLoreSearchService normalizes Vietnamese query and returns ranked snippets', async () => {
  const provider = createFakeEmbeddingProvider({ 'thánh gióng': [1, 0] })
  const service = new SemanticLoreSearchService({
    embeddingProvider: provider,
    index: createSimpleIndex(),
    defaultTopK: 4,
    relevanceThreshold: 0.1
  })

  const result = await service.search({ query: 'tha\u0301nh gio\u0301ng', topK: 1 })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.snippets, [
      {
        source: 'thanh-giong.md',
        heading: 'Đền Sóc Sơn',
        text: 'Thánh Gióng cưỡi ngựa sắt bay về trời.',
        score: 1
      }
    ])
  }
  assert.deepEqual(provider.queries, ['thánh gióng'])
})

test('SemanticLoreSearchService returns controlled failure when index is unavailable', async () => {
  const provider = createFakeEmbeddingProvider({ 'query': [1, 0] })
  const service = new SemanticLoreSearchService({
    embeddingProvider: provider,
    index: null,
    defaultTopK: 4,
    relevanceThreshold: 0.1
  })

  const result = await service.search({ query: 'query' })

  assert.deepEqual(result, { ok: false, source: 'fallback', errorCode: 'rag-index-unavailable' })
  assert.equal(provider.queryCalls, 0)
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

function createFakeEmbeddingProvider(vectors: Record<string, number[]>): EmbeddingProvider & {
  queryCalls: number
  queries: string[]
} {
  return {
    dimension: 2,
    queryCalls: 0,
    queries: [],
    async embedQuery(text: string): Promise<number[]> {
      this.queryCalls += 1
      this.queries.push(text)
      return vectors[text] ?? [0, 1]
    },
    async embedDocuments(texts: readonly string[]): Promise<readonly number[][]> {
      return texts.map((text) => vectors[text] ?? [0, 1])
    }
  }
}
