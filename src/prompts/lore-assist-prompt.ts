import type { LoreAssistRequest } from '../contracts.js'
import type { ChatCompletionRequest } from '../llm-client.js'

export function buildLoreAssistPrompt(request: LoreAssistRequest): ChatCompletionRequest {
  return {
    systemPrompt: buildLoreAssistSystemPrompt(request),
    userMessage: buildLoreAssistUserMessage(request),
    maxTokens: 320,
    temperature: 0.25
  }
}

function buildLoreAssistSystemPrompt(request: LoreAssistRequest): string {
  return [
    'You are a folklore NPC assistant in Adventura.',
    'Rewrite only the approved game-fiction context into a short player-facing hint or recap.',
    'Do not add quests, rewards, items, bosses, classes, locations, unlocks, or real-world history claims.',
    `Assist kind: ${request.kind}.`,
    request.maxLength ? `Maximum length: ${request.maxLength} characters.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function buildLoreAssistUserMessage(request: LoreAssistRequest): string {
  const context = request.approvedContext.length
    ? request.approvedContext.map((entry) => `- ${entry}`).join('\n')
    : '- No approved context.'
  return [
    request.storylineId ? `Storyline: ${request.storylineId}` : '',
    request.questId ? `Quest: ${request.questId}` : '',
    request.npcId ? `NPC: ${request.npcId}` : '',
    request.trigger ? `Trigger: ${request.trigger}` : '',
    'Approved context:',
    context,
    `Fallback/base text: ${request.baseText}`,
    'Return one concise in-character sentence.'
  ]
    .filter(Boolean)
    .join('\n\n')
}
