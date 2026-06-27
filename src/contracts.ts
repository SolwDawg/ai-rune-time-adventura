export const AI_FALLBACK_TEXT = 'Luc nay ta chua the tra loi. Hay hoi lai sau.'

export interface NpcDialogueRequest {
  readonly npcId: string
  readonly playerText: string
  readonly loreSnippets?: readonly string[]
  readonly persona?: string
  readonly language?: string
}

export interface LoreSearchRequest {
  readonly query: string
  readonly topK?: number
  readonly storylineId?: string
  readonly npcId?: string
}

export interface LoreSnippet {
  readonly source: string
  readonly heading: string
  readonly text: string
  readonly score: number
}

export interface StoryReasoningRequest {
  readonly questionId: string
  readonly prompt: string
  readonly playerText: string
  readonly approvedContext?: readonly string[]
  readonly rubric?: readonly string[]
}

export type AiRuntimeTextResponse =
  | {
      readonly ok: true
      readonly source: 'ai'
      readonly text: string
    }
  | {
      readonly ok: false
      readonly source: 'fallback'
      readonly text: string
    }

export type LoreSearchResponse =
  | {
      readonly ok: true
      readonly source: 'rag'
      readonly snippets: readonly LoreSnippet[]
    }
  | {
      readonly ok: false
      readonly source: 'fallback'
      readonly errorCode: string
    }

export type StoryReasoningResponse =
  | {
      readonly ok: true
      readonly assessment: string
      readonly feedback: string
      readonly source: 'ai'
    }
  | {
      readonly ok: false
      readonly assessment: 'unavailable'
      readonly feedback: string
      readonly source: 'fallback'
      readonly errorCode: string
    }
