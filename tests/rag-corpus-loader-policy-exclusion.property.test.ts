import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import fc from 'fast-check'

import { loadLoreCorpus } from '../src/rag/corpus-loader.js'

// A generated specification for one markdown file to be written before loading.
// Categories deliberately cover the three policy-exclusion vectors plus the
// valid-corpus baseline so the property is not vacuously satisfied:
//   - 'valid'        : a normal retrievable corpus file
//   - 'forbidden'    : a corpus file whose name contains "forbidden"
//   - 'policy'       : a corpus file whose name contains "policy"
//   - 'policy-dir'   : a file that lives only inside RAG_POLICY_DIR
//   - 'shared-name'  : the same file name present in BOTH dirs (corpus copy
//                      must be skipped because it collides with a policy file)
type FileCategory = 'valid' | 'forbidden' | 'policy' | 'policy-dir' | 'shared-name'

interface FileSpec {
  readonly category: FileCategory
  readonly slug: string
  readonly heading: string
  readonly body: string
}

// Filesystem-safe slug fragment used only to diversify file names.
const slugArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''))

// Heading / body fragments may include Vietnamese accents to exercise normalize.
const fragmentArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 àáảãạăâđêôơưèéĐ'.split('')), {
    minLength: 0,
    maxLength: 16
  })
  .map((chars) => chars.join(''))

const fileSpecArb: fc.Arbitrary<FileSpec> = fc.record({
  category: fc.constantFrom<FileCategory>('valid', 'forbidden', 'policy', 'policy-dir', 'shared-name'),
  slug: slugArb,
  heading: fragmentArb,
  body: fragmentArb
})

const corpusArb = fc.array(fileSpecArb, { minLength: 0, maxLength: 12 })

function isPolicyOriginName(fileName: string, policyDirNames: ReadonlySet<string>): boolean {
  return /(?:forbidden|policy)/i.test(fileName) || policyDirNames.has(fileName)
}

// Feature: storyline-scoped-npc-chatbot, Property 9: Policy_Store không bao giờ truy hồi được
test('Property 9: loadLoreCorpus never yields a chunk originating from policy', () => {
  fc.assert(
    fc.property(corpusArb, (specs) => {
      const root = mkdtempSync(join(tmpdir(), 'adventura-rag-policy-prop-'))
      try {
        const corpusDir = join(root, 'corpus')
        const policyDir = join(root, 'policy')
        mkdirSync(corpusDir)
        mkdirSync(policyDir)

        const policyDirNames = new Set<string>()
        // Corpus files we expect to survive (non-policy, content-bearing).
        const expectedValidSources = new Set<string>()

        specs.forEach((spec, index) => {
          // LF line endings only — readFrontMatter requires the exact "---\n"
          // marker and the chunk splitter is newline-sensitive; CRLF would
          // break front-matter/heading parsing. The 'H'/'L' prefixes guarantee
          // a non-empty heading + body so a valid file always yields a chunk.
          const validContent = [`## H${spec.heading}`, '', `L${spec.body}`].join('\n')

          switch (spec.category) {
            case 'valid': {
              const name = `c${index}_${spec.slug}.md`
              writeFileSync(join(corpusDir, name), validContent, 'utf8')
              // Guard against the (vanishingly unlikely) random "policy"/
              // "forbidden" substring before counting it as an expected survivor.
              if (!/(?:forbidden|policy)/i.test(name)) {
                expectedValidSources.add(name)
              }
              break
            }
            case 'forbidden': {
              const name = `c${index}_forbidden_${spec.slug}.md`
              writeFileSync(join(corpusDir, name), validContent, 'utf8')
              break
            }
            case 'policy': {
              const name = `c${index}_policy_${spec.slug}.md`
              writeFileSync(join(corpusDir, name), validContent, 'utf8')
              break
            }
            case 'policy-dir': {
              const name = `p${index}_${spec.slug}.md`
              writeFileSync(
                join(policyDir, name),
                ['# Policy', '', '## Forbidden Phrases', '', `sealed secret ${spec.slug}`].join('\n'),
                'utf8'
              )
              policyDirNames.add(name)
              break
            }
            case 'shared-name': {
              const name = `s${index}_${spec.slug}.md`
              // Same file name in both dirs: the corpus copy must be skipped
              // because it collides with a policy file.
              writeFileSync(join(corpusDir, name), validContent, 'utf8')
              writeFileSync(
                join(policyDir, name),
                ['# Policy', '', '## Forbidden Phrases', '', 'do not leak'].join('\n'),
                'utf8'
              )
              policyDirNames.add(name)
              break
            }
          }
        })

        const loaded = loadLoreCorpus({ corpusDir, policyDir })

        // Core property: zero loaded chunks originate from a policy file.
        for (const chunk of loaded.chunks) {
          assert.equal(
            isPolicyOriginName(chunk.source, policyDirNames),
            false,
            `policy-originated chunk leaked into corpus: ${chunk.source}`
          )
        }

        // Anti-vacuity: every valid corpus file must still be retrievable, so a
        // pass cannot be explained by the loader simply dropping everything.
        const loadedSources = new Set(loaded.chunks.map((chunk) => chunk.source))
        for (const source of expectedValidSources) {
          assert.ok(loadedSources.has(source), `expected valid corpus source missing: ${source}`)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }),
    { numRuns: 200 }
  )
})
