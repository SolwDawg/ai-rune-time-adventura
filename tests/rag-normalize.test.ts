import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeText } from '../src/rag/normalize.js'

test('normalizeText normalizes Vietnamese text to NFC', () => {
  const decomposed = 'tha\u0301nh gio\u0301ng'
  const normalized = normalizeText(decomposed)

  assert.equal(normalized, 'thánh gióng')
  assert.equal(normalized, normalized.normalize('NFC'))
})

test('normalizeText preserves Vietnamese accents', () => {
  const value = 'Đền Sóc Sơn giữ ký ức Thánh Gióng.'

  assert.equal(normalizeText(value), value)
})
