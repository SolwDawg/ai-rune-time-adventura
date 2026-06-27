import assert from 'node:assert/strict'
import test from 'node:test'

import { buildNpcDialoguePrompt } from '../src/prompts/npc-dialogue-prompt.js'
import { buildStoryReasoningPrompt } from '../src/prompts/story-reasoning-prompt.js'

test('buildNpcDialoguePrompt includes authority boundary and grounded context', () => {
  const prompt = buildNpcDialoguePrompt({
    npcId: 'tg_village_elder_npc',
    playerText: 'Ke cho toi ve truyen thanh giong',
    persona: 'wise village elder',
    language: 'vi',
    loreSnippets: ['Giong grows after the village asks for help.', 'The iron horse is prepared by the king.']
  })

  assert.equal(prompt.maxTokens, 512)
  assert.equal(prompt.temperature, 0.35)
  assert.match(prompt.systemPrompt, /Do not grant rewards, complete quests, mutate inventory, or override server state\./)
  assert.match(prompt.systemPrompt, /NPC id: tg_village_elder_npc/)
  assert.match(prompt.systemPrompt, /Persona: wise village elder/)
  assert.match(prompt.systemPrompt, /Language: vi/)
  assert.match(prompt.userMessage, /Player text: Ke cho toi ve truyen thanh giong/)
  assert.match(prompt.userMessage, /Giong grows after the village asks for help\./)
  assert.match(prompt.userMessage, /The iron horse is prepared by the king\./)
})

test('buildStoryReasoningPrompt keeps reasoning advisory and uses approved context', () => {
  const prompt = buildStoryReasoningPrompt({
    questionId: 'tg_oath_question',
    prompt: 'Vi sao loi hua voi lang quan trong?',
    playerText: 'Vi loi hua giup moi nguoi tin nhau.',
    approvedContext: ['The oath binds the village together.']
  })

  assert.equal(prompt.maxTokens, 512)
  assert.equal(prompt.temperature, 0.1)
  assert.match(prompt.systemPrompt, /advisory assessment/i)
  assert.match(prompt.systemPrompt, /Do not grant rewards, complete quests, mutate inventory, or override server state\./)
  assert.match(prompt.systemPrompt, /Return strict JSON/)
  assert.match(prompt.userMessage, /Question id: tg_oath_question/)
  assert.match(prompt.userMessage, /The oath binds the village together\./)
  assert.match(prompt.userMessage, /Vi loi hua giup moi nguoi tin nhau\./)
})
