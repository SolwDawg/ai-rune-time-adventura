import assert from 'node:assert/strict'
import test from 'node:test'

import { createOpenAiChatClient } from '../src/llm-client.js'
import type { RuntimeConfig } from '../src/config.js'

test('completeChat posts OpenAI-compatible request shape and trims base URL', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createOpenAiChatClient(
    createRuntimeConfig({
      llm: {
        baseUrl: 'http://localhost:1234/v1/',
        model: 'local-model',
        apiKey: 'local-key',
        requestTimeoutMs: 12000
      }
    }).llm,
    (async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} })
      return jsonResponse({
        choices: [{ message: { content: '  Xin chao.  ' } }]
      })
    }) as typeof fetch
  )

  const result = await client.completeChat({
    systemPrompt: 'system rules',
    userMessage: 'player text',
    maxTokens: 123,
    temperature: 0.2
  })

  assert.deepEqual(result, { ok: true, text: 'Xin chao.' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://localhost:1234/v1/chat/completions')
  assert.equal(requests[0].init.method, 'POST')
  assert.deepEqual(requests[0].init.headers, {
    Authorization: 'Bearer local-key',
    'Content-Type': 'application/json'
  })
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    model: 'local-model',
    messages: [
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'player text' }
    ],
    max_tokens: 123,
    temperature: 0.2
  })
})

test('completeChat logs provider request and response payloads when enabled', async () => {
  const logs: string[] = []
  const client = createOpenAiChatClient(
    createRuntimeConfig({
      llm: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-flash-lite',
        apiKey: 'secret-key',
        requestTimeoutMs: 12000,
        reasoningEffort: 'none',
        warmupEnabled: false,
        logPayloadsEnabled: true
      }
    }).llm,
    (async () =>
      jsonResponse({
        choices: [{ message: { content: '  Làng đang có điềm chẳng lành.  ' } }]
      })) as typeof fetch,
    { info: (message) => logs.push(message) }
  )

  const result = await client.completeChat({
    systemPrompt: 'Giữ vai Trưởng Làng.',
    userMessage: 'Trong làng đang xảy ra chuyện gì?',
    maxTokens: 80,
    temperature: 0.25
  })

  assert.deepEqual(result, { ok: true, text: 'Làng đang có điềm chẳng lành.' })
  assert.equal(logs.length, 2)
  assert.match(logs[0], /^\[llm\] request /)
  assert.match(logs[0], /"url":"https:\/\/generativelanguage.googleapis.com\/v1beta\/openai\/chat\/completions"/)
  assert.match(logs[0], /"model":"gemini-2.5-flash-lite"/)
  assert.match(logs[0], /"content":"Trong làng đang xảy ra chuyện gì\?"/)
  assert.doesNotMatch(logs[0], /secret-key/)
  assert.match(logs[1], /^\[llm\] response /)
  assert.match(logs[1], /"status":200/)
  assert.match(logs[1], /"content":"  Làng đang có điềm chẳng lành.  "/)
  assert.doesNotMatch(logs[1], /secret-key/)
})

test('completeChat fails safely without model and does not call fetch', async () => {
  let fetchCalls = 0
  const client = createOpenAiChatClient(
    createRuntimeConfig({
      llm: {
        baseUrl: 'http://localhost:1234/v1',
        model: '',
        apiKey: 'local-key',
        requestTimeoutMs: 12000
      }
    }).llm,
    (async () => {
      fetchCalls += 1
      return jsonResponse({})
    }) as typeof fetch
  )

  const result = await client.completeChat({ systemPrompt: 'system', userMessage: 'user' })

  assert.deepEqual(result, { ok: false, reason: 'missing-model' })
  assert.equal(fetchCalls, 0)
})

test('completeChat reports timeout when provider request is aborted', async () => {
  const client = createOpenAiChatClient(
    createRuntimeConfig({
      llm: {
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        apiKey: 'local-key',
        requestTimeoutMs: 5
      }
    }).llm,
    (async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })) as typeof fetch
  )

  const result = await client.completeChat({ systemPrompt: 'system', userMessage: 'user' })

  assert.deepEqual(result, { ok: false, reason: 'timeout' })
})

test('completeChat reports provider error for non-2xx response', async () => {
  const client = createOpenAiChatClient(
    createRuntimeConfig().llm,
    (async () => jsonResponse({ error: 'bad request' }, { status: 500 })) as typeof fetch
  )

  const result = await client.completeChat({ systemPrompt: 'system', userMessage: 'user' })

  assert.deepEqual(result, { ok: false, reason: 'provider-error' })
})

test('completeChat reports provider error for malformed response content', async () => {
  const client = createOpenAiChatClient(
    createRuntimeConfig().llm,
    (async () => jsonResponse({ choices: [{ message: { content: '   ' } }] })) as typeof fetch
  )

  const result = await client.completeChat({ systemPrompt: 'system', userMessage: 'user' })

  assert.deepEqual(result, { ok: false, reason: 'provider-error' })
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function createRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    authToken: '',
    llm: {
      baseUrl: 'http://localhost:1234/v1',
      model: 'test-model',
      apiKey: 'local-dev-key',
      requestTimeoutMs: 12000,
      reasoningEffort: 'none',
      warmupEnabled: false,
      logPayloadsEnabled: false
    },
    ...overrides
  }
}
