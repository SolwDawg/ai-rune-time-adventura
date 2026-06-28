import assert from 'node:assert/strict'
import test from 'node:test'

import { CachingEmbeddingProvider } from '../src/rag/caching-embedding-provider.js'
import type { EmbeddingCache } from '../src/rag/embedding-cache.js'
import type { EmbeddingProvider } from '../src/rag/embedding-provider.js'
import { createRng, genOneOf, genString, type Gen } from './helpers/gen.js'

// Feature: ai-runtime-performance, Property 8
//
// Property 8: Embedding cache failure falls back to live computation.
// For any query, if the cache get or set throws, CachingEmbeddingProvider.embedQuery
// still returns the underlying provider's vector and never rejects.
// Validates: Requirements 3.6, 6.1

const DIMENSION = 4

function vectorFor(text: string): number[] {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  const base = hash / 1000
  return Array.from({ length: DIMENSION }, (_, i) => base + i)
}

class FakeInner implements EmbeddingProvider {
  readonly dimension = DIMENSION
  async embedQuery(text: string): Promise<number[]> {
    return vectorFor(text)
  }
  embedDocuments(texts: readonly string[]): Promise<readonly number[][]> {
    return Promise.resolve(texts.map((t) => vectorFor(t)))
  }
}

type ThrowMode = 'get' | 'set' | 'both'

// A cache whose get and/or set throw, modelling Redis-style failures on the
// in-process cache surface.
function makeThrowingCache(mode: ThrowMode): EmbeddingCache {
  const throwGet = mode === 'get' || mode === 'both'
  const throwSet = mode === 'set' || mode === 'both'
  return {
    get(): number[] | undefined {
      if (throwGet) {
        throw new Error('cache get boom')
      }
      return undefined
    },
    set(): void {
      if (throwSet) {
        throw new Error('cache set boom')
      }
    },
    get size(): number {
      return 0
    }
  } as unknown as EmbeddingCache
}

const silentLogger = { warn(): void {} }

interface Scenario {
  readonly mode: ThrowMode
  readonly query: string
}

const genScenario: Gen<Scenario> = (rng) => ({
  mode: genOneOf<ThrowMode>('get', 'set', 'both')(rng),
  query: genString({ minLength: 0, maxLength: 20 })(rng)
})

test('Property 8: a throwing cache still returns the inner vector and never rejects', async () => {
  const runs = 100
  for (let i = 0; i < runs; i += 1) {
    const seed = (i + 1) * 0x9e3779b1
    const rng = createRng(seed)
    const scenario = genScenario(rng)
    try {
      const provider = new CachingEmbeddingProvider(new FakeInner(), makeThrowingCache(scenario.mode), silentLogger)
      const result = await provider.embedQuery(scenario.query)
      assert.deepEqual(result, vectorFor(scenario.query), 'must return the inner provider vector on cache failure')
    } catch (error) {
      if (error instanceof Error) {
        error.message = `Property 8 failed (iteration ${i}, seed ${seed}) for sample: ${JSON.stringify(scenario)}\n${error.message}`
      }
      throw error
    }
  }
})

// --- Sanity unit checks ------------------------------------------------------
test('a throwing get falls back to live computation', async () => {
  const provider = new CachingEmbeddingProvider(new FakeInner(), makeThrowingCache('get'), silentLogger)
  assert.deepEqual(await provider.embedQuery('hello'), vectorFor('hello'))
})

test('a throwing set does not prevent returning the live vector', async () => {
  const provider = new CachingEmbeddingProvider(new FakeInner(), makeThrowingCache('set'), silentLogger)
  assert.deepEqual(await provider.embedQuery('world'), vectorFor('world'))
})
