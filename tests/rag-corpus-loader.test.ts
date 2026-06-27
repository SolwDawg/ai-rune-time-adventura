import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadLoreCorpus } from '../src/rag/corpus-loader.js'

test('loadLoreCorpus chunks markdown and preserves Vietnamese accents', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'adventura-rag-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const corpusDir = join(root, 'corpus')
  const policyDir = join(root, 'policy')
  mkdirSync(corpusDir)
  mkdirSync(policyDir)

  writeFileSync(
    join(corpusDir, 'thanh-giong.md'),
    ['# Thanh Giong', '', '## Đền Sóc Sơn', '', 'Thánh Gióng cưỡi ngựa sắt bay về trời.'].join('\n'),
    'utf8'
  )

  const loaded = loadLoreCorpus({ corpusDir, policyDir })

  assert.equal(loaded.chunks.length, 1)
  assert.deepEqual(loaded.chunks[0], {
    id: 'thanh-giong.md#den-soc-son',
    source: 'thanh-giong.md',
    heading: 'Đền Sóc Sơn',
    text: 'Thánh Gióng cưỡi ngựa sắt bay về trời.'
  })
})

test('loadLoreCorpus loads policy separately and skips policy files from corpus', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'adventura-rag-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const corpusDir = join(root, 'corpus')
  const policyDir = join(root, 'policy')
  mkdirSync(corpusDir)
  mkdirSync(policyDir)

  writeFileSync(join(corpusDir, 'world.md'), '# World\n\n## Shrine\n\nSafe retrievable lore.', 'utf8')
  writeFileSync(join(corpusDir, 'forbidden-canon.md'), '# Forbidden Canon\n\n## Forbidden Rules\n\nDo not retrieve.', 'utf8')
  writeFileSync(
    join(policyDir, 'forbidden-canon.md'),
    ['# Forbidden Canon', '', '## Forbidden Phrases', '', 'sealed emperor', 'forbidden blood rite'].join('\n'),
    'utf8'
  )

  const warnings: string[] = []
  const loaded = loadLoreCorpus({
    corpusDir,
    policyDir,
    logger: { warn: (message) => warnings.push(message) }
  })

  assert.deepEqual(
    loaded.chunks.map((chunk) => chunk.source),
    ['world.md']
  )
  assert.deepEqual(loaded.policy.forbiddenPhrases, ['sealed emperor', 'forbidden blood rite'])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Skipping policy file from corpus: forbidden-canon\.md/)
})
