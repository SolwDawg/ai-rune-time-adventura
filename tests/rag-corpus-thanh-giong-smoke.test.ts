import assert from 'node:assert/strict'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { parseRuntimeConfig } from '../src/config.js'
import { loadLoreCorpus } from '../src/rag/corpus-loader.js'

// Feature: storyline-scoped-npc-chatbot, Task 3.3 (smoke test)
// Validates: Requirements 4.1
//
// The real Thanh Giong corpus authored in data/lore-corpus must load through
// loadLoreCorpus and yield at least one LoreCorpusChunk tagged with the
// canonical storylineId `thanh_giong`. This also guards the front-matter LF
// pitfall in readFrontMatter: a CRLF `---\r\n` header would silently drop the
// storylineId and fail this assertion.

const THANH_GIONG_STORYLINE_ID = 'thanh_giong'

// Repo root is one level up from this tests/ directory; resolving the configured
// (relative) corpus/policy dirs against it makes the test robust to the cwd the
// runner happens to use.
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function resolveFromRepoRoot(dir: string): string {
  return isAbsolute(dir) ? dir : resolve(REPO_ROOT, dir)
}

test('Thanh Giong corpus loads at least one chunk scoped to storylineId thanh_giong', () => {
  // Resolve corpus/policy dirs the same way the app does: read the parsed runtime
  // config (honours RAG_CORPUS_DIR / RAG_POLICY_DIR env overrides, defaults to
  // data/lore-corpus + data/lore-policy), then anchor to the repo root.
  const config = parseRuntimeConfig()
  const corpusDir = resolveFromRepoRoot(config.rag.corpusDir)
  const policyDir = resolveFromRepoRoot(config.rag.policyDir)

  const loaded = loadLoreCorpus({ corpusDir, policyDir })

  const thanhGiongChunks = loaded.chunks.filter((chunk) => chunk.storylineId === THANH_GIONG_STORYLINE_ID)

  assert.ok(
    thanhGiongChunks.length >= 1,
    `expected >=1 chunk with storylineId="${THANH_GIONG_STORYLINE_ID}", got ${thanhGiongChunks.length}. ` +
      `If 0, check the data/lore-corpus/thanh-giong-*.md front matter uses LF "---\\n" (not CRLF).`
  )

  // Every Thanh Giong chunk carries the exact canonical storylineId.
  for (const chunk of thanhGiongChunks) {
    assert.equal(chunk.storylineId, THANH_GIONG_STORYLINE_ID)
  }

  // Policy content is never retrievable as a corpus chunk (RAG_POLICY_DIR is
  // excluded), so no loaded chunk originates from a policy source file.
  for (const chunk of loaded.chunks) {
    assert.doesNotMatch(chunk.source, /(?:forbidden|policy)/i)
  }
})
