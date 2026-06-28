import assert from 'node:assert/strict'
import test from 'node:test'

import { computeIndexSignature, type IndexSignatureInput } from '../src/rag/index-signature.js'
import { createRng, forAll, genInt, genString, type Gen } from './helpers/gen.js'

// Feature: ai-runtime-performance, Property 9
//
// Property 9: Index_Signature tracks index-affecting state.
// For any two Index_Signature inputs, the computed signature is equal iff dimension,
// embedding model, entry count, and serialized index bytes are all equal; any change to
// corpus content (changed bytes), dimension, or embedding model yields a different
// signature.
// Validates: Requirements 2.1, 2.2, 5.3

const genModel = genString({ minLength: 0, maxLength: 20 })
const genBytes = genString({ minLength: 0, maxLength: 48 })

const genInput: Gen<IndexSignatureInput> = (rng) => ({
  dimension: genInt(1, 1024)(rng),
  embeddingModel: genModel(rng),
  entryCount: genInt(0, 100000)(rng),
  indexFileBytes: genBytes(rng)
})

// A scenario produces a base input plus a second input that independently keeps or
// changes each of the four index-affecting fields. expectedEqual is true iff every
// field was kept equal, so the signature-equality check exercises both branches of
// the "iff".
interface Scenario {
  readonly a: IndexSignatureInput
  readonly b: IndexSignatureInput
  readonly expectedEqual: boolean
}

const genScenario: Gen<Scenario> = (rng) => {
  const a = genInput(rng)

  const changeDim = rng.next() < 0.5
  const changeModel = rng.next() < 0.5
  const changeCount = rng.next() < 0.5
  const changeBytes = rng.next() < 0.5

  const b: IndexSignatureInput = {
    // A guaranteed-different value for each changed field (positive delta / appended char).
    dimension: changeDim ? a.dimension + genInt(1, 64)(rng) : a.dimension,
    embeddingModel: changeModel ? `${a.embeddingModel}${genString({ minLength: 1, maxLength: 4 })(rng)}` : a.embeddingModel,
    entryCount: changeCount ? a.entryCount + genInt(1, 256)(rng) : a.entryCount,
    indexFileBytes: changeBytes
      ? `${a.indexFileBytes as string}${genString({ minLength: 1, maxLength: 4 })(rng)}`
      : a.indexFileBytes
  }

  const expectedEqual = !changeDim && !changeModel && !changeCount && !changeBytes
  return { a, b, expectedEqual }
}

test('Property 9: signature is equal iff all index-affecting fields are equal', () => {
  forAll(100, genScenario, ({ a, b, expectedEqual }) => {
    const sigA = computeIndexSignature(a)
    const sigB = computeIndexSignature(b)
    assert.equal(
      sigA === sigB,
      expectedEqual,
      `expected signature equality=${expectedEqual} but got sigA=${sigA} sigB=${sigB}`
    )
  })
})

test('Property 9: signature is deterministic for an identical input', () => {
  forAll(100, genInput, (input) => {
    const copy: IndexSignatureInput = {
      dimension: input.dimension,
      embeddingModel: input.embeddingModel,
      entryCount: input.entryCount,
      indexFileBytes: input.indexFileBytes
    }
    assert.equal(computeIndexSignature(input), computeIndexSignature(copy))
  })
})

test('Property 9: changing any single field changes the signature', () => {
  forAll(100, genInput, (input) => {
    const rng = createRng(0x515ab1e)
    const base = computeIndexSignature(input)

    const changedDim = computeIndexSignature({ ...input, dimension: input.dimension + 1 })
    const changedModel = computeIndexSignature({ ...input, embeddingModel: `${input.embeddingModel}x` })
    const changedCount = computeIndexSignature({ ...input, entryCount: input.entryCount + 1 })
    const changedBytes = computeIndexSignature({
      ...input,
      indexFileBytes: `${input.indexFileBytes as string}${genString({ minLength: 1, maxLength: 2 })(rng)}_`
    })

    assert.notEqual(changedDim, base, 'dimension change must alter signature')
    assert.notEqual(changedModel, base, 'embedding model change must alter signature')
    assert.notEqual(changedCount, base, 'entry count change must alter signature')
    assert.notEqual(changedBytes, base, 'index bytes change must alter signature')
  })
})

// --- Sanity unit checks ------------------------------------------------------
test('computeIndexSignature returns the idx_ prefixed 32-char hash form', () => {
  const sig = computeIndexSignature({
    dimension: 384,
    embeddingModel: 'minilm',
    entryCount: 12,
    indexFileBytes: 'corpus-bytes'
  })
  assert.match(sig, /^idx_[0-9a-f]{32}$/)
})

test('computeIndexSignature treats Buffer and string bytes with equal content identically', () => {
  const asString = computeIndexSignature({
    dimension: 384,
    embeddingModel: 'minilm',
    entryCount: 3,
    indexFileBytes: 'same-content'
  })
  const asBuffer = computeIndexSignature({
    dimension: 384,
    embeddingModel: 'minilm',
    entryCount: 3,
    indexFileBytes: Buffer.from('same-content')
  })
  assert.equal(asString, asBuffer)
})
