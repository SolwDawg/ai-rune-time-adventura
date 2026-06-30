import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import fc from 'fast-check'

import { LoreIndex } from '../src/rag/lore-index.js'
import type { EmbeddingIndexEntry } from '../src/rag/embedding-index.js'
import type { LoreCorpusChunk } from '../src/rag/corpus-loader.js'

// Storyline-scoping properties for LoreIndex (tasks 2.2 / 2.3 / 2.4).
//
// Per design.md "Testing Strategy", these are property-based tests written with
// the ecosystem PBT library (fast-check), NOT the in-house tests/helpers/gen.ts
// seam. matchesScope() is private, so every property exercises the public
// LoreIndex.searchVector API and reasons purely about the scope filter.
//
// Score/topK isolation trick: every entry gets a zero vector and the query is
// the zero vector too, so cosineSimilarity is a constant 0 for all entries; with
// threshold = -1 (cosine is clamped to [-1, 1]) and topK >= corpus size, neither
// the relevance threshold nor topK truncation can drop anything. A chunk appears
// in the result iff it passes matchesScope — the scope filter is the only filter.
//
// LoreSnippet does not expose storylineId/npcId, so each chunk is given a UNIQUE
// `source` and results are mapped back to their generated spec via that source.

// Storyline ids used both to tag chunks and to form request scopes. Includes a
// diacritic-bearing id ('cot-truyen-é') to exercise Vietnamese characters in ids.
const STORYLINE_IDS: readonly string[] = [
  'thanh_giong',
  'son_tinh_thuy_tinh',
  'au_co_lac_long_quan',
  'cot-truyen-é',
  'X'
]

// NPC ids likewise, including a diacritic id, for the npc-filter dimension.
const NPC_IDS: readonly string[] = ['giong', 'me_giong', 'su_gia', 'npc-é', 'N']

// Body-text fragment generator covering empty strings and Vietnamese diacritics.
const vietFragmentArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789 àáảãạăâđêôơưèéĐ Long Mạch Thánh Gióng làng nước'.split('')
    ),
    { minLength: 0, maxLength: 12 }
  )
  .map((chars) => chars.join(''))

interface ChunkSpec {
  readonly storylineId?: string
  readonly npcId?: string
  readonly body: string
}

// A chunk that MAY carry a storylineId and/or npcId (option nil => unlabeled,
// i.e. Shared_Lore for the storyline dimension).
const chunkSpecArb: fc.Arbitrary<ChunkSpec> = fc.record({
  storylineId: fc.option(fc.constantFrom(...STORYLINE_IDS), { nil: undefined }),
  npcId: fc.option(fc.constantFrom(...NPC_IDS), { nil: undefined }),
  body: vietFragmentArb
})

interface BuiltCorpus {
  readonly entries: EmbeddingIndexEntry[]
  readonly bySource: Map<string, ChunkSpec>
}

// Builds an index-ready corpus from chunk specs. Each chunk gets a unique source
// (so results can be mapped back) and a zero vector of the chosen dimension.
function buildCorpus(specs: readonly ChunkSpec[], dimension: number): BuiltCorpus {
  const zeroVector = new Array<number>(dimension).fill(0)
  const entries: EmbeddingIndexEntry[] = []
  const bySource = new Map<string, ChunkSpec>()

  specs.forEach((spec, index) => {
    const source = `chunk-${index}.md`
    const chunk: LoreCorpusChunk = {
      id: `id-${index}`,
      source,
      heading: `Heading ${index}`,
      // Body marker carries diacritics + a unique index for diagnostics.
      text: `BODY::${index}::${spec.body}`,
      ...(spec.storylineId !== undefined ? { storylineId: spec.storylineId } : {}),
      ...(spec.npcId !== undefined ? { npcId: spec.npcId } : {})
    }
    entries.push({ chunk, vector: [...zeroVector] })
    bySource.set(source, spec)
  })

  return { entries, bySource }
}

describe('LoreIndex storyline scoping (property)', () => {
  // Feature: storyline-scoped-npc-chatbot, Property 2: Cô lập theo cốt truyện
  // For any corpus of mixed storylineIds (incl. unlabeled Shared_Lore) and any
  // request storylineId = X, no returned chunk has storylineId != X. npcId is
  // intentionally omitted so only the storyline dimension is under test.
  it('Property 2: no result chunk belongs to a storyline other than the requested one', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(chunkSpecArb, { minLength: 0, maxLength: 12 }),
        fc.constantFrom(...STORYLINE_IDS),
        (dimension, specs, requestStorylineId) => {
          const { entries, bySource } = buildCorpus(specs, dimension)
          const index = new LoreIndex({ dimension, entries })

          const results = index.searchVector({
            queryVector: new Array<number>(dimension).fill(0),
            topK: Math.max(1, entries.length),
            threshold: -1,
            storylineId: requestStorylineId
          })

          // Isolation: every returned chunk is either Shared_Lore (no storylineId)
          // or tagged with exactly the requested storyline.
          for (const result of results) {
            const spec = bySource.get(result.source)
            assert.ok(spec, `result source not from generated corpus: ${result.source}`)
            assert.ok(
              spec.storylineId === undefined || spec.storylineId === requestStorylineId,
              `cross-storyline leak: chunk storylineId=${String(spec.storylineId)} ` +
                `leaked into request storylineId=${requestStorylineId} (${result.source})`
            )
          }

          // Anti-vacuity: the result set EQUALS the expected in-scope set, so a
          // pass cannot be explained by the index returning nothing.
          const expected = new Set(
            entries
              .filter((entry) => {
                const spec = bySource.get(entry.chunk.source) as ChunkSpec
                return spec.storylineId === undefined || spec.storylineId === requestStorylineId
              })
              .map((entry) => entry.chunk.source)
          )
          const actual = new Set(results.map((result) => result.source))
          assert.deepEqual(actual, expected, 'in-scope result set did not match expected')
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: storyline-scoped-npc-chatbot, Property 3: Bao gồm Shared_Lore
  // For any set of chunks with no storylineId (Shared_Lore) and ANY request
  // storylineId (including undefined), every Shared_Lore chunk is always included.
  it('Property 3: every Shared_Lore chunk (no storylineId) is always in scope for any request storylineId', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        // At least one Shared_Lore chunk so the inclusion property is never vacuous.
        fc.array(fc.record({ npcId: fc.option(fc.constantFrom(...NPC_IDS), { nil: undefined }), body: vietFragmentArb }), {
          minLength: 1,
          maxLength: 6
        }),
        // Mixed storyline-tagged (and unlabeled) chunks to keep the corpus realistic.
        fc.array(chunkSpecArb, { minLength: 0, maxLength: 6 }),
        // Any request storyline, including undefined (request without a storyline).
        fc.option(fc.constantFrom(...STORYLINE_IDS), { nil: undefined }),
        (dimension, sharedSpecs, otherSpecs, requestStorylineId) => {
          const sharedChunkSpecs: ChunkSpec[] = sharedSpecs.map((spec) => ({
            storylineId: undefined,
            npcId: spec.npcId,
            body: spec.body
          }))
          const specs = [...sharedChunkSpecs, ...otherSpecs]
          const { entries, bySource } = buildCorpus(specs, dimension)
          const index = new LoreIndex({ dimension, entries })

          // npcId omitted: only the storyline dimension gates inclusion here.
          const results = index.searchVector({
            queryVector: new Array<number>(dimension).fill(0),
            topK: Math.max(1, entries.length),
            threshold: -1,
            storylineId: requestStorylineId
          })

          const resultSources = new Set(results.map((result) => result.source))
          const sharedSources = entries
            .filter((entry) => (bySource.get(entry.chunk.source) as ChunkSpec).storylineId === undefined)
            .map((entry) => entry.chunk.source)

          // Non-vacuous by construction: at least one Shared_Lore chunk exists.
          assert.ok(sharedSources.length >= 1, 'expected at least one Shared_Lore chunk')
          for (const source of sharedSources) {
            assert.ok(
              resultSources.has(source),
              `Shared_Lore chunk excluded by storyline scope ` +
                `(requestStorylineId=${String(requestStorylineId)}): ${source}`
            )
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: storyline-scoped-npc-chatbot, Property 4: Lọc theo NPC
  // For any request npcId = N, every result chunk has npcId == N or no npcId.
  // storylineId is omitted so only the NPC dimension is under test.
  it('Property 4: every result chunk has npcId == N or no npcId when requesting npcId = N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(chunkSpecArb, { minLength: 0, maxLength: 12 }),
        fc.constantFrom(...NPC_IDS),
        (dimension, specs, requestNpcId) => {
          const { entries, bySource } = buildCorpus(specs, dimension)
          const index = new LoreIndex({ dimension, entries })

          // storylineId omitted: only the npc dimension gates inclusion here.
          const results = index.searchVector({
            queryVector: new Array<number>(dimension).fill(0),
            topK: Math.max(1, entries.length),
            threshold: -1,
            npcId: requestNpcId
          })

          for (const result of results) {
            const spec = bySource.get(result.source)
            assert.ok(spec, `result source not from generated corpus: ${result.source}`)
            assert.ok(
              spec.npcId === undefined || spec.npcId === requestNpcId,
              `cross-npc leak: chunk npcId=${String(spec.npcId)} ` +
                `leaked into request npcId=${requestNpcId} (${result.source})`
            )
          }

          // Anti-vacuity: result set EQUALS the expected npc-in-scope set.
          const expected = new Set(
            entries
              .filter((entry) => {
                const spec = bySource.get(entry.chunk.source) as ChunkSpec
                return spec.npcId === undefined || spec.npcId === requestNpcId
              })
              .map((entry) => entry.chunk.source)
          )
          const actual = new Set(results.map((result) => result.source))
          assert.deepEqual(actual, expected, 'npc-in-scope result set did not match expected')
        }
      ),
      { numRuns: 100 }
    )
  })
})
