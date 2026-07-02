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

type LlmPayloadLogger = {
  info(message: string): void
}

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export function createOpenAiChatClient(
  config: RuntimeConfig['llm'],
  fetchFn: FetchLike = fetch,
  logger: LlmPayloadLogger = console
): ChatClient {
  const baseUrl = trimTrailingSlash(config.baseUrl)

  return {
    async completeChat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
      if (!config.model) {
        return { ok: false, reason: 'missing-model' }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)

      try {
        const url = `${baseUrl}/chat/completions`
        const body = {
          model: config.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userMessage }
          ],
          max_tokens: request.maxTokens ?? 220,
          temperature: request.temperature ?? 0.35,
          ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {})
        }

        logProviderPayload(config, logger, 'request', { url, body })

        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })

        if (!response.ok) {
          logProviderPayload(config, logger, 'response', {
            status: response.status,
            ok: false,
            body: await readResponseTextSafely(response)
          })
          return { ok: false, reason: 'provider-error' }
        }

        const payload = (await response.json()) as OpenAiChatResponse
        logProviderPayload(config, logger, 'response', {
          status: response.status,
          ok: true,
          body: payload
        })
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

function logProviderPayload(
  config: RuntimeConfig['llm'],
  logger: LlmPayloadLogger,
  direction: 'request' | 'response',
  payload: unknown
): void {
  if (!config.logPayloadsEnabled) {
    return
  }

  logger.info(`[llm] ${direction} ${JSON.stringify(payload)}`)
}

async function readResponseTextSafely(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
