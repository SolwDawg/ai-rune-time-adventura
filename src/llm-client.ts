import type { RuntimeConfig } from './config.js'

export interface ChatCompletionRequest {
  readonly systemPrompt: string
  readonly userMessage: string
  readonly maxTokens?: number
  readonly temperature?: number
}

export type ChatCompletionResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'missing-model' | 'timeout' | 'provider-error' }

export interface ChatClient {
  completeChat(request: ChatCompletionRequest): Promise<ChatCompletionResult>
}

type FetchLike = typeof fetch

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export function createOpenAiChatClient(config: RuntimeConfig['llm'], fetchFn: FetchLike = fetch): ChatClient {
  const baseUrl = trimTrailingSlash(config.baseUrl)

  return {
    async completeChat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
      if (!config.model) {
        return { ok: false, reason: 'missing-model' }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)

      try {
        const response = await fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userMessage }
            ],
            max_tokens: request.maxTokens ?? 220,
            temperature: request.temperature ?? 0.35,
            ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {})
          }),
          signal: controller.signal
        })

        if (!response.ok) {
          return { ok: false, reason: 'provider-error' }
        }

        const payload = (await response.json()) as OpenAiChatResponse
        const text = payload.choices?.[0]?.message?.content?.trim()
        return text ? { ok: true, text } : { ok: false, reason: 'provider-error' }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return { ok: false, reason: 'timeout' }
        }

        return { ok: false, reason: 'provider-error' }
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
