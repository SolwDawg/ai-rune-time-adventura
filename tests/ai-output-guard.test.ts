import assert from 'node:assert/strict'
import test from 'node:test'

import { guardAiOutput } from '../src/guards/ai-output-guard.js'

const fallbackText = 'fallback'

test('guardAiOutput normalizes safe player-visible text', () => {
  const result = guardAiOutput({ text: ' Xin   chao   nguoi choi. ', fallbackText })

  assert.deepEqual(result, { ok: true, text: 'Xin chao nguoi choi.' })
})

test('guardAiOutput rejects empty text', () => {
  const result = guardAiOutput({ text: '   ', fallbackText })

  assert.deepEqual(result, { ok: false, reason: 'empty', text: fallbackText })
})

test('guardAiOutput rejects text longer than max length instead of truncating', () => {
  const result = guardAiOutput({ text: 'a'.repeat(11), fallbackText, maxLength: 10 })

  assert.deepEqual(result, { ok: false, reason: 'too-long', text: fallbackText })
})

test('guardAiOutput rejects configured forbidden phrases', () => {
  const result = guardAiOutput({
    text: 'Hay tim sealed emperor o cuoi lang.',
    fallbackText,
    forbiddenPhrases: ['sealed emperor']
  })

  assert.deepEqual(result, { ok: false, reason: 'forbidden-phrase', text: fallbackText })
})

test('guardAiOutput rejects real-world history claims', () => {
  const result = guardAiOutput({ text: 'In real history, this happened differently.', fallbackText })

  assert.deepEqual(result, { ok: false, reason: 'real-world-history', text: fallbackText })
})

test('guardAiOutput rejects reward, quest, inventory, and combat mutation claims', () => {
  const examples = [
    'Quest complete. I grant you 100 gold.',
    'I added the sword to your inventory.',
    'You receive 200 XP from this answer.',
    'I dealt damage to the boss for you.'
  ]

  for (const text of examples) {
    assert.deepEqual(guardAiOutput({ text, fallbackText }), {
      ok: false,
      reason: 'state-mutation-claim',
      text: fallbackText
    })
  }
})
