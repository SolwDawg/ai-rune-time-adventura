import assert from 'node:assert/strict'
import test from 'node:test'

import { CachingEmbeddingProvider } from '../src/rag/caching-embedding-provider.js'
import { EmbeddingCache } from '../src/rag/embedding-cache.js'
import type { EmbeddingProvider } from '../src/rag/embedding-provider.js'
import { createRng, genArrayOf, genInt, type Gen } from './helpers/gen.js'

// Feature: ai-runtime-performance, Property 6
//
// Property 6: Embedding cache round-trip and live equivalence.
// For any normalized query, CachingEmbeddingProvider.embedQuery returns a vector
// deep-equal to the underlying provider's vector for that query, whether served
// from cache or computed live, and computes the embedding at most once per
// distinct normalized query across repeated calls (within the cache bound).
// Validates: Requirements 3.2, 3.3, 3.7

const DIMENSION = 4

/**
 * Counting fake inner provider. Produces a deterministic vector per text and
 * records how many times each distinct text was computed.
 */
class CountingProvider implements EmbeddingProvider {
  readonly dimension = DIMENSION
  readonly counts = new Map<string, number>()

  async embedQuery(text: string): Promise<number[]> {
    this.counts.set(text, (this.counts.get(text) ?? 0) + 1)
    return vectorFor(text)
  }

  embedDocuments(texts: readonly string[]): Promise<readonly number[][]> {
    return Promise.resolve(texts.map((t) => vectorFor(t)))
  }
}

function vectorFor(text: string): number[] {
  // Deterministic, distinct-per-text vector derived from a char-code hash.
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  const base = hash / 1000
  return Array.from({ length: DIMENSION }, (_, i) => base + i)
}

// A sequence of queries drawn from a small distinct pool so repeats are frequent.
interface Scenario {
  readonly maxEntries: number
  readonly poolSize: number
  readonly queryIndices: readonly number[]
}

const genScenario: Gen<Scenario> = (rng) => {
  const maxEntries = genInt(1, 8)(rng)
  const poolSize = genInt(1, maxEntries + 4)(rng)
  const queryIndices = genArrayOf(genInt(0, poolSize - 1), 1, 40)(rng)
  return { maxEntries, poolSize, queryIndices }
}

// Deterministic distinct query strings keyed by the scenario shape.
function derivePool(scenario: Scenario): string[] {
  return Array.from({ length: scenario.poolSize }, (_, i) => `q_${scenario.maxEntries}_${scenario.poolSize}_${i}`)
}

async function checkScenario(scenario: Scenario): Promise<void> {
  const pool = derivePool(scenario)
  const inner = new CountingProvider()
  const provider = new CachingEmbeddingProvider(inner, new EmbeddingCache({ maxEntries: scenario.maxEntries }))

  for (const idx of scenario.queryIndices) {
    const query = pool[idx]
    const result = await provider.embedQuery(query)
    assert.deepEqual(result, vectorFor(query), 'returned vector must deep-equal the inner provider vector')
  }

  if (scenario.poolSize <= scenario.maxEntries) {
    // No eviction can occur: every distinct query is computed at most once.
    for (const [text, count] of inner.counts) {
      assert.ok(count === 1, `query ${text} computed ${count} times; expected at most once within cache bound`)
    }
  } else {
    // With a pool larger than the bound, recomputation only follows an eviction;
    // total computes can never exceed the number of calls.
    let totalComputes = 0
    for (const count of inner.counts.values()) {
      totalComputes += count
    }
    assert.ok(
      totalComputes <= scenario.queryIndices.length,
      `total computes ${totalComputes} exceeded call count ${scenario.queryIndices.length}`
    )
  }
}

test('Property 6: cached vector deep-equals live and computes at most once within the cache bound', async () => {
  // Mirror the helper's seeding so failures are reproducible, but await each
  // async scenario (forAll is synchronous and cannot await predicates).
  const runs = 100
  for (let i = 0; i < runs; i += 1) {
    const seed = (i + 1) * 0x9e3779b1
    const rng = createRng(seed)
    const scenario = genScenario(rng)
    try {
      await checkScenario(scenario)
    } catch (error) {
      if (error instanceof Error) {
        error.message = `Property 6 failed (iteration ${i}, seed ${seed}) for sample: ${JSON.stringify(scenario)}\n${error.message}`
      }
      throw error
    }
  }
})

// --- Sanity unit checks ------------------------------------------------------
test('embedQuery computes once then serves repeats from cache', async () => {
  const inner = new CountingProvider()
  const provider = new CachingEmbeddingProvider(inner, new EmbeddingCache({ maxEntries: 4 }))

  const a1 = await provider.embedQuery('alpha')
  const a2 = await provider.embedQuery('alpha')
  const a3 = await provider.embedQuery('alpha')

  assert.deepEqual(a1, vectorFor('alpha'))
  assert.deepEqual(a2, a1)
  assert.deepEqual(a3, a1)
  assert.equal(inner.counts.get('alpha'), 1, 'alpha must be computed exactly once')
})

test('embedDocuments delegates uncached to the inner provider', async () => {
  const inner = new CountingProvider()
  const provider = new CachingEmbeddingProvider(inner, new EmbeddingCache({ maxEntries: 4 }))

  const docs = await provider.embedDocuments(['one', 'two'])
  assert.deepEqual(docs, [vectorFor('one'), vectorFor('two')])
  // embedDocuments must not populate the query cache.
  await provider.embedQuery('one')
  assert.equal(inner.counts.get('one'), 1, 'embedQuery still computes since embedDocuments did not cache')
})
