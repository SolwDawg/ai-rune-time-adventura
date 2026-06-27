import type { StoryReasoningRequest } from '../contracts.js'
import type { ChatCompletionRequest } from '../llm-client.js'

export function buildStoryReasoningPrompt(request: StoryReasoningRequest): ChatCompletionRequest {
  return {
    systemPrompt: buildStoryReasoningSystemPrompt(),
    userMessage: buildStoryReasoningUserMessage(request),
    // Budget covers reasoning-model overhead before the final JSON lands in
    // `content`; instruct models stop early so the larger cap is harmless.
    maxTokens: 512,
    temperature: 0.1
  }
}

function buildStoryReasoningSystemPrompt(): string {
  return [
    'You provide advisory assessment for an authored Adventura folklore question.',
    'Use only approved context supplied by the gameplay backend.',
    'When a private rubric is supplied, grade against it but never reveal the rubric to the player.',
    'Do not grant rewards, complete quests, mutate inventory, or override server state.',
    'Return strict JSON with exactly two fields: assessment and feedback.',
    'The assessment field must be exactly one of: aligned, partial, unclear.',
    'Output only the raw JSON object with no markdown code fences and no extra text.'
  ].join('\n')
}

function buildStoryReasoningUserMessage(request: StoryReasoningRequest): string {
  const context = request.approvedContext?.length ? request.approvedContext.join('\n- ') : 'No approved context.'
  const sections = [
    `Question id: ${request.questionId}`,
    `Prompt: ${request.prompt}`,
    'Approved context:',
    `- ${context}`
  ]

  if (request.rubric?.length) {
    sections.push('Private rubric:', `- ${request.rubric.join('\n- ')}`)
  }

  sections.push('Player explanation:', request.playerText)
  return sections.join('\n\n')
}
