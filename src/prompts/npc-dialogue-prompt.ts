import type { NpcDialogueRequest } from '../contracts.js'
import type { ChatCompletionRequest } from '../llm-client.js'

export function buildNpcDialoguePrompt(request: NpcDialogueRequest): ChatCompletionRequest {
  return {
    systemPrompt: buildNpcDialogueSystemPrompt(request),
    userMessage: buildNpcDialogueUserMessage(request),
    // Budget covers reasoning-model overhead (the final answer lands in `content`
    // only after the model spends tokens reasoning); instruct models stop early.
    maxTokens: 512,
    temperature: 0.35
  }
}

function buildNpcDialogueSystemPrompt(request: NpcDialogueRequest): string {
  const prompt = [
    'You are an Adventura NPC dialogue assistant.',
    'Answer only as in-world NPC dialogue.',
    'Use only the grounded lore snippets supplied by the gameplay backend.',
    'Do not grant rewards, complete quests, mutate inventory, or override server state.',
    `NPC id: ${request.npcId}`
  ]

  if (request.persona) {
    prompt.push(`Persona: ${request.persona}`)
  }

  if (request.language) {
    prompt.push(`Language: ${request.language}`)
  }

  return prompt.join('\n')
}

function buildNpcDialogueUserMessage(request: NpcDialogueRequest): string {
  const lore = request.loreSnippets?.length ? request.loreSnippets.join('\n---\n') : 'No grounded lore snippets.'
  return [`Player text: ${request.playerText}`, 'Grounded lore snippets:', lore].join('\n\n')
}
