import type { NpcDialogueRequest } from '../contracts.js'
import type { ChatCompletionRequest } from '../llm-client.js'

export function buildNpcDialoguePrompt(request: NpcDialogueRequest): ChatCompletionRequest {
  return {
    systemPrompt: buildNpcDialogueSystemPrompt(request),
    userMessage: buildNpcDialogueUserMessage(request),
    // Reasoning is disabled by default (config reasoningEffort=none), so a modest
    // budget covers the short in-world reply; raise if reasoning is re-enabled.
    maxTokens: 320,
    temperature: 0.35
  }
}

function buildNpcDialogueSystemPrompt(request: NpcDialogueRequest): string {
  const prompt = [
    'You are an Adventura NPC dialogue assistant.',
    'Answer only as in-world NPC dialogue.',
    'Use only the grounded lore snippets supplied by the gameplay backend.',
    'Do not grant rewards, complete quests, mutate inventory, or override server state.',
    'Return strict JSON with a required "message" field and an optional "emotion" field.',
    'The emotion field, when present, must be exactly one of: neutral, happy, worried, serious, angry, sad.',
    'Output only the raw JSON object with no markdown code fences and no extra text.',
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
