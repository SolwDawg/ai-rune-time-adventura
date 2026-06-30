export const AI_FALLBACK_TEXT = 'Luc nay ta chua the tra loi. Hay hoi lai sau.'

export interface NpcDialogueRequest {
  readonly npcId: string
  readonly playerText: string
  readonly mode?: 'npc-dialogue' | 'chatbot'
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
  // Additive, optional, backward-compatible: identifies the quest milestone a
  // chunk is gated behind (from corpus front matter). The Backend uses it to
  // drop snippets the player has not unlocked yet (anti-spoiler, Req 3.1/3.2).
  // Chunks with no questId are non-gated lore and omit this field.
  readonly questId?: string
}

export interface StoryReasoningRequest {
  readonly questionId: string
  readonly prompt: string
  readonly playerText: string
  readonly approvedContext?: readonly string[]
  readonly rubric?: readonly string[]
}

export interface LoreAssistRequest {
  readonly kind: 'hint' | 'recap'
  readonly approvedContext: readonly string[]
  readonly baseText: string
  readonly maxLength?: number
  readonly storylineId?: string
  readonly questId?: string
  readonly npcId?: string
  readonly trigger?: string
}

export type NpcDialogueEmotion = 'neutral' | 'happy' | 'worried' | 'serious' | 'angry' | 'sad'

export type AiRuntimeTextResponse =
  | {
      readonly ok: true
      readonly source: 'ai'
      readonly text: string
      readonly emotion?: NpcDialogueEmotion
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
      // Additive, optional, backward-compatible: identifies the embedding index
      // state so the Backend can key its lore-search cache on it. Older clients
      // and existing integration tests ignore this field.
      readonly indexSignature?: string
    }
  | {
      readonly ok: false
      readonly source: 'fallback'
      readonly errorCode: string
      readonly indexSignature?: string
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
