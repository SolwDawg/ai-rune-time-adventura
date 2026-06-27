import assert from 'node:assert/strict'
import test from 'node:test'

import { deserializeEmbeddingIndex, serializeEmbeddingIndex } from '../src/rag/embedding-index.js'
import { LoreIndex } from '../src/rag/lore-index.js'

test('embedding index serialization preserves metadata and vectors', () => {
  const serialized = serializeEmbeddingIndex({
    dimension: 3,
    entries: [
      {
        chunk: {
          id: 'world.md#long-mach',
          source: 'world.md',
          heading: 'Long Mạch',
          text: 'Long Mạch là dòng chảy cổ.'
        },
        vector: [0.1, 0.2, 0.3]
      }
    ]
  })

  const result = deserializeEmbeddingIndex(serialized)

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.index.dimension, 3)
    assert.deepEqual(result.index.entries[0].chunk, {
      id: 'world.md#long-mach',
      source: 'world.md',
      heading: 'Long Mạch',
      text: 'Long Mạch là dòng chảy cổ.'
    })
    assert.deepEqual(result.index.entries[0].vector, [0.1, 0.2, 0.3])
  }
})

test('LoreIndex ranks by cosine score, threshold, topK, and deterministic tie breakers', () => {
  const index = new LoreIndex({
    dimension: 2,
    entries: [
      {
        chunk: { id: 'b.md#same', source: 'b.md', heading: 'Same', text: 'B same score.' },
        vector: [1, 0]
      },
      {
        chunk: { id: 'a.md#same', source: 'a.md', heading: 'Same', text: 'A same score.' },
        vector: [1, 0]
      },
      {
        chunk: { id: 'c.md#low', source: 'c.md', heading: 'Low', text: 'Low score.' },
        vector: [0, 1]
      }
    ]
  })

  const results = index.searchVector({
    queryVector: [1, 0],
    topK: 2,
    threshold: 0.1
  })

  assert.deepEqual(
    results.map((result) => result.source),
    ['a.md', 'b.md']
  )
  assert.deepEqual(
    results.map((result) => result.score),
    [1, 1]
  )
})
