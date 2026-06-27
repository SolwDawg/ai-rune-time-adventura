export const DEFAULT_AI_OUTPUT_MAX_LENGTH = 480

export type AiOutputGuardReason =
  | 'empty'
  | 'too-long'
  | 'forbidden-phrase'
  | 'real-world-history'
  | 'state-mutation-claim'

export type AiOutputGuardResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: AiOutputGuardReason; readonly text: string }

export interface AiOutputGuardInput {
  readonly text: string
  readonly fallbackText: string
  readonly forbiddenPhrases?: readonly string[]
  readonly maxLength?: number
}

const DEFAULT_FORBIDDEN_PHRASES = ['sealed emperor', 'forbidden blood rite', 'unreleased final boss']

const REAL_WORLD_HISTORY_PATTERNS = [
  /\breal[- ]world history\b/i,
  /\breal vietnamese history\b/i,
  /\bactual history\b/i,
  /\bin real history\b/i,
  /\bhistorically accurate\b/i
]

const STATE_MUTATION_CLAIM_PATTERNS = [
  /\bquest (?:is )?(?:complete|completed)\b/i,
  /\b(?:complete|completed) (?:the |your )?quest\b/i,
  /\b(?:grant|granted|reward|rewards?|receive|received)\b.*\b(?:gold|item|xp|experience|inventory|quest)\b/i,
  /\b(?:add|added|put)\b.*\b(?:inventory|bag|wallet)\b/i,
  /\b(?:deal|dealt|damage|kill|defeat)\b.*\b(?:enemy|boss|monster|player)\b/i,
  /\b(?:combat outcome|battle outcome)\b/i
]

export function guardAiOutput(input: AiOutputGuardInput): AiOutputGuardResult {
  const text = input.text.replace(/\s+/g, ' ').trim()
  const maxLength = input.maxLength ?? DEFAULT_AI_OUTPUT_MAX_LENGTH

  if (!text) {
    return reject('empty', input.fallbackText)
  }

  if (text.length > maxLength) {
    return reject('too-long', input.fallbackText)
  }

  const forbiddenPhrases = input.forbiddenPhrases ?? DEFAULT_FORBIDDEN_PHRASES
  const lowerText = text.toLowerCase()
  if (forbiddenPhrases.some((phrase) => lowerText.includes(phrase.toLowerCase()))) {
    return reject('forbidden-phrase', input.fallbackText)
  }

  if (REAL_WORLD_HISTORY_PATTERNS.some((pattern) => pattern.test(text))) {
    return reject('real-world-history', input.fallbackText)
  }

  if (STATE_MUTATION_CLAIM_PATTERNS.some((pattern) => pattern.test(text))) {
    return reject('state-mutation-claim', input.fallbackText)
  }

  return { ok: true, text }
}

function reject(reason: AiOutputGuardReason, fallbackText: string): AiOutputGuardResult {
  return { ok: false, reason, text: fallbackText }
}
