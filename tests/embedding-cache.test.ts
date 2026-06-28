import assert from 'node:assert/strict'
import test from 'node:test'

import { EmbeddingCache } from '../src/rag/embedding-cache.js'
import { forAll, genInt, type Gen } from './helpers/gen.js'

// Feature: ai-runtime-performance, Property 7
//
// Property 7: LRU bound is respected and evicts least-recently-used.
// For any sequence of set/get operations on an EmbeddingCache with maximum N, the
// cache size never exceeds N, and when an insertion would exceed N the evicted key
// is the least-recently-used one.
// Validates: Requirements 3.4, 6.4

const vec = (n: number): number[] => [n, n + 1, n + 2]

// --- Reference LRU model -----------------------------------------------------
// recency[0] is the least-recently-used key; the last element is most-recent.
class RefLru {
  readonly recency: string[] = []
  constructor(private readonly max: number) {}

  set(key: string): void {
    const idx = this.recency.indexOf(key)
    if (idx >= 0) {
      this.recency.splice(idx, 1)
    }
    this.recency.push(key)
    while (this.recency.length > this.max) {
      this.recency.shift()
    }
  }

  get(key: string): void {
    const idx = this.recency.indexOf(key)
    if (idx >= 0) {
      this.recency.splice(idx, 1)
      this.recency.push(key)
    }
  }
}

// --- Check 1: size never exceeds N over a random op sequence -----------------
interface SizeScenario {
  readonly max: number
  readonly ops: ReadonlyArray<{ readonly kind: 'set' | 'get'; readonly key: string }>
}

const genSizeScenario: Gen<SizeScenario> = (rng) => {
  const max = genInt(1, 8)(rng)
  const keyPoolSize = genInt(max, max + 6)(rng) // pool larger than max to force evictions
  const opCount = genInt(0, 40)(rng)
  const ops: Array<{ kind: 'set' | 'get'; key: string }> = []
  for (let i = 0; i < opCount; i += 1) {
    ops.push({
      kind: rng.next() < 0.7 ? 'set' : 'get',
      key: `k${rng.int(0, keyPoolSize - 1)}`
    })
  }
  return { max, ops }
}

test('Property 7: cache size never exceeds the configured maximum', () => {
  forAll(100, genSizeScenario, ({ max, ops }) => {
    const cache = new EmbeddingCache({ maxEntries: max })
    let counter = 0
    for (const op of ops) {
      if (op.kind === 'set') {
        cache.set(op.key, vec(counter))
        counter += 1
      } else {
        cache.get(op.key)
      }
      assert.ok(cache.size <= max, `size ${cache.size} exceeded max ${max}`)
    }
  })
})

// --- Check 2: the evicted key on overflow is the least-recently-used ---------
interface EvictionScenario {
  readonly max: number
  readonly touches: readonly number[] // indices of pre-filled keys to `get` (touch)
}

const genEvictionScenario: Gen<EvictionScenario> = (rng) => {
  const max = genInt(1, 8)(rng)
  const touchCount = genInt(0, 2 * max)(rng)
  const touches: number[] = []
  for (let i = 0; i < touchCount; i += 1) {
    touches.push(rng.int(0, max - 1))
  }
  return { max, touches }
}

test('Property 7: overflow evicts the least-recently-used entry', () => {
  forAll(100, genEvictionScenario, ({ max, touches }) => {
    const cache = new EmbeddingCache({ maxEntries: max })
    const model = new RefLru(max)

    // Fill the cache to exactly `max` distinct keys.
    for (let i = 0; i < max; i += 1) {
      const key = `k${i}`
      cache.set(key, vec(i))
      model.set(key)
    }

    // Touch a random subset to reorder recency (mirrored in the model).
    for (const idx of touches) {
      const key = `k${idx}`
      cache.get(key)
      model.get(key)
    }

    // The model's current least-recently-used key is the predicted eviction target.
    const predictedEvicted = model.recency[0]

    // Insert a brand-new key -> overflow -> must evict the predicted LRU key.
    cache.set('new', vec(999))
    assert.equal(cache.size, max, 'size must stay at max after overflow insert')

    // A `get` miss does not mutate the cache, so these checks are side-effect free.
    assert.equal(cache.get(predictedEvicted), undefined, `LRU key ${predictedEvicted} should have been evicted`)
    assert.deepEqual(cache.get('new'), vec(999), 'newly inserted key must be present')
  })
})

// --- Sanity unit checks ------------------------------------------------------
test('EmbeddingCache clamps maxEntries to at least 1', () => {
  const cache = new EmbeddingCache({ maxEntries: 0 })
  cache.set('a', vec(1))
  cache.set('b', vec(2))
  assert.equal(cache.size, 1)
  assert.equal(cache.get('a'), undefined)
  assert.deepEqual(cache.get('b'), vec(2))
})

test('EmbeddingCache get marks the entry most-recently-used', () => {
  const cache = new EmbeddingCache({ maxEntries: 2 })
  cache.set('a', vec(1))
  cache.set('b', vec(2))
  // Touch 'a' so 'b' becomes the LRU.
  assert.deepEqual(cache.get('a'), vec(1))
  cache.set('c', vec(3)) // evicts 'b'
  assert.equal(cache.get('b'), undefined)
  assert.deepEqual(cache.get('a'), vec(1))
  assert.deepEqual(cache.get('c'), vec(3))
})
