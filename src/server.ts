import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { parseRuntimeConfig, type RuntimeConfig } from './config.js'
import {
  AI_FALLBACK_TEXT,
  type AiRuntimeTextResponse,
  type LoreSearchRequest,
  type LoreSearchResponse,
  type NpcDialogueRequest,
  type StoryReasoningRequest,
  type StoryReasoningResponse
} from './contracts.js'
import { guardAiOutput } from './guards/ai-output-guard.js'
import { createOpenAiChatClient, type ChatClient } from './llm-client.js'
import { buildNpcDialoguePrompt } from './prompts/npc-dialogue-prompt.js'
import { buildStoryReasoningPrompt } from './prompts/story-reasoning-prompt.js'
import { createSemanticLoreSearchService, type LoreSearcher } from './rag/lore-search-service.js'

export interface StartServerOptions {
  readonly port?: number
  readonly config?: RuntimeConfig
  readonly chatClient?: ChatClient
  readonly loreSearcher?: LoreSearcher
}

export interface RunningServer {
  readonly url: string
  close(): Promise<void>
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const config = options.config ?? parseRuntimeConfig()
  const chatClient = options.chatClient ?? createOpenAiChatClient(config.llm)
  const loreSearcher = options.loreSearcher ?? (await createSemanticLoreSearchService(config.rag))

  const server = createServer((request, response) => {
    void handleRequest(request, response, chatClient, loreSearcher, config)
  })

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? config.port, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('AI runtime server did not bind to a TCP port.')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  chatClient: ChatClient,
  loreSearcher: LoreSearcher,
  config: RuntimeConfig
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', service: 'adventura-ai-runtime' })
    return
  }

  if (request.method === 'GET' && url.pathname === '/ready') {
    sendJson(response, 200, buildReadiness(config))
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/npc-dialogue') {
    if (!isAuthorized(request, config.authToken)) {
      sendUnauthorized(response)
      return
    }

    const body = await readJson(request)
    const result = await resolveNpcDialogue(body, chatClient)
    sendJson(response, 200, result)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/lore/search') {
    if (!isAuthorized(request, config.authToken)) {
      sendUnauthorized(response)
      return
    }

    const body = await readJson(request)
    const result = await resolveLoreSearch(body, loreSearcher)
    sendJson(response, 200, result)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/story-reasoning') {
    if (!isAuthorized(request, config.authToken)) {
      sendUnauthorized(response)
      return
    }

    const body = await readJson(request)
    const result = await resolveStoryReasoning(body, chatClient)
    sendJson(response, 200, result)
    return
  }

  sendJson(response, 404, { ok: false, error: 'not-found' })
}

function buildReadiness(config: RuntimeConfig) {
  const llm = config.llm.model.trim()
    ? { ready: true as const }
    : { ready: false as const, reason: 'missing-model' as const }
  const rag = config.rag.indexFile.trim() && config.rag.embeddingModel.trim() && config.rag.corpusDir.trim()
    ? { ready: true as const }
    : { ready: false as const, reason: 'missing-rag-config' as const }

  return {
    status: llm.ready && rag.ready ? ('ok' as const) : ('degraded' as const),
    service: 'adventura-ai-runtime',
    dependencies: { llm, rag }
  }
}

async function resolveNpcDialogue(body: unknown, chatClient: ChatClient): Promise<AiRuntimeTextResponse> {
  const request = normalizeNpcDialogueRequest(body)
  if (!request) {
    return { ok: false, source: 'fallback', text: AI_FALLBACK_TEXT }
  }

  const result = await chatClient.completeChat(buildNpcDialoguePrompt(request))

  if (!result.ok) {
    return { ok: false, source: 'fallback', text: AI_FALLBACK_TEXT }
  }

  const guarded = guardAiOutput({ text: result.text, fallbackText: AI_FALLBACK_TEXT })
  return guarded.ok ? { ok: true, source: 'ai', text: guarded.text } : { ok: false, source: 'fallback', text: guarded.text }
}

function normalizeNpcDialogueRequest(body: unknown): NpcDialogueRequest | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const candidate = body as Partial<NpcDialogueRequest>
  if (typeof candidate.npcId !== 'string' || typeof candidate.playerText !== 'string') {
    return null
  }

  return {
    npcId: candidate.npcId,
    playerText: candidate.playerText,
    loreSnippets: Array.isArray(candidate.loreSnippets)
      ? candidate.loreSnippets.filter((snippet): snippet is string => typeof snippet === 'string')
      : [],
    persona: typeof candidate.persona === 'string' ? candidate.persona : undefined,
    language: typeof candidate.language === 'string' ? candidate.language : undefined
  }
}

async function resolveLoreSearch(body: unknown, loreSearcher: LoreSearcher): Promise<LoreSearchResponse> {
  const request = normalizeLoreSearchRequest(body)
  if (!request) {
    return { ok: false, source: 'fallback', errorCode: 'invalid-request' }
  }

  return loreSearcher.search(request)
}

function normalizeLoreSearchRequest(body: unknown): LoreSearchRequest | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const candidate = body as Partial<LoreSearchRequest>
  if (typeof candidate.query !== 'string') {
    return null
  }

  return {
    query: candidate.query,
    topK: Number.isSafeInteger(candidate.topK) ? candidate.topK : undefined,
    storylineId: typeof candidate.storylineId === 'string' ? candidate.storylineId : undefined,
    npcId: typeof candidate.npcId === 'string' ? candidate.npcId : undefined
  }
}

async function resolveStoryReasoning(body: unknown, chatClient: ChatClient): Promise<StoryReasoningResponse> {
  const request = normalizeStoryReasoningRequest(body)
  if (!request) {
    return fallbackStoryReasoning('invalid-request')
  }

  const result = await chatClient.completeChat(buildStoryReasoningPrompt(request))

  if (!result.ok) {
    return fallbackStoryReasoning(result.reason)
  }

  const parsed = parseStoryReasoningResult(result.text)
  if (!parsed) {
    return fallbackStoryReasoning('malformed-response')
  }

  const feedback = guardAiOutput({ text: parsed.feedback, fallbackText: AI_FALLBACK_TEXT })
  return feedback.ok
    ? { ok: true, assessment: parsed.assessment, feedback: feedback.text, source: 'ai' }
    : fallbackStoryReasoning('guard-rejected')
}

function normalizeStoryReasoningRequest(body: unknown): StoryReasoningRequest | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const candidate = body as Partial<StoryReasoningRequest>
  if (
    typeof candidate.questionId !== 'string' ||
    typeof candidate.prompt !== 'string' ||
    typeof candidate.playerText !== 'string'
  ) {
    return null
  }

  return {
    questionId: candidate.questionId,
    prompt: candidate.prompt,
    playerText: candidate.playerText,
    approvedContext: Array.isArray(candidate.approvedContext)
      ? candidate.approvedContext.filter((entry): entry is string => typeof entry === 'string')
      : [],
    rubric: Array.isArray(candidate.rubric)
      ? candidate.rubric.filter((entry): entry is string => typeof entry === 'string')
      : []
  }
}

function parseStoryReasoningResult(text: string): { assessment: string; feedback: string } | null {
  try {
    const parsed = JSON.parse(stripJsonFence(text.trim())) as { assessment?: unknown; feedback?: unknown }
    if (typeof parsed.assessment !== 'string' || typeof parsed.feedback !== 'string') {
      return null
    }

    return {
      assessment: parsed.assessment,
      feedback: parsed.feedback
    }
  } catch {
    return null
  }
}

function stripJsonFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return fenced ? fenced[1].trim() : text
}

function fallbackStoryReasoning(errorCode: string): StoryReasoningResponse {
  return {
    ok: false,
    assessment: 'unavailable',
    feedback: AI_FALLBACK_TEXT,
    source: 'fallback',
    errorCode
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return null
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return null
  }
}

function isAuthorized(request: IncomingMessage, authToken: string): boolean {
  if (!authToken) {
    return true
  }

  return request.headers.authorization === `Bearer ${authToken}`
}

function sendUnauthorized(response: ServerResponse): void {
  sendJson(response, 401, { ok: false, source: 'fallback', errorCode: 'unauthorized' })
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
