import assert from 'node:assert/strict'
import test from 'node:test'

import { startServer } from '../src/server.js'
import { AI_FALLBACK_TEXT } from '../src/contracts.js'
import type { ChatClient } from '../src/llm-client.js'
import type { RuntimeConfig } from '../src/config.js'
import type { LoreSearcher } from '../src/rag/lore-search-service.js'

test('GET /health returns service status', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient('unused'),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/health`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    status: 'ok',
    service: 'adventura-ai-runtime'
  })
})

test('startServer uses configured bind host in its advertised URL', async (t) => {
  const server = await startServer({
    port: 0,
    config: createRuntimeConfig({ host: '0.0.0.0', authToken: 'runtime-private-token' }),
    chatClient: createFakeChatClient('unused'),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  assert.match(server.url, /^http:\/\/0\.0\.0\.0:\d+$/)
})

test('startServer rejects network-exposed bind hosts without an auth token', async () => {
  let server: Awaited<ReturnType<typeof startServer>> | null = null

  try {
    await assert.rejects(
      async () => {
        server = await startServer({
          port: 0,
          config: createRuntimeConfig({ host: '0.0.0.0', authToken: '' }),
          chatClient: createFakeChatClient('unused'),
          loreSearcher: createStubLoreSearcher()
        })
      },
      /AI_RUNTIME_AUTH_TOKEN/
    )
  } finally {
    await server?.close()
  }
})

test('startServer rejects non-local bind hosts without an auth token', async () => {
  await assert.rejects(
    async () => {
      const server = await startServer({
        port: 0,
        config: createRuntimeConfig({ host: '192.0.2.10', authToken: '' }),
        chatClient: createFakeChatClient('unused'),
        loreSearcher: createStubLoreSearcher()
      })
      await server.close()
    },
    /AI_RUNTIME_AUTH_TOKEN/
  )
})

test('GET /ready reports dependency readiness without calling providers', async (t) => {
  let chatCalls = 0
  let loreSearchCalls = 0
  const baseConfig = createRuntimeConfig()
  const server = await startServer({
    port: 0,
    config: {
      ...baseConfig,
      llm: {
        ...baseConfig.llm,
        model: ''
      }
    },
    chatClient: {
      completeChat: async () => {
        chatCalls += 1
        throw new Error('readiness must not call text-generation provider')
      }
    },
    loreSearcher: {
      search: async () => {
        loreSearchCalls += 1
        throw new Error('readiness must not call lore search')
      }
    }
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/ready`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    status: 'degraded',
    service: 'adventura-ai-runtime',
    dependencies: {
      llm: { ready: false, reason: 'missing-model' },
      rag: { ready: true }
    }
  })
  assert.equal(chatCalls, 0)
  assert.equal(loreSearchCalls, 0)
  assert.equal(JSON.stringify(body).includes('local-dev-key'), false)
  assert.equal(JSON.stringify(body).includes('http://localhost:1234/v1'), false)
})

test('private endpoint contract rejects missing required fields before provider calls', async (t) => {
  let chatCalls = 0
  let loreSearchCalls = 0
  const server = await startServer({
    port: 0,
    chatClient: {
      completeChat: async () => {
        chatCalls += 1
        throw new Error('invalid contract requests must not call text-generation provider')
      }
    },
    loreSearcher: {
      search: async () => {
        loreSearchCalls += 1
        throw new Error('invalid contract requests must not call lore search')
      }
    }
  })
  t.after(() => server.close())

  const cases = [
    {
      path: '/v1/npc-dialogue',
      body: { npcId: 'guide_npc' },
      expected: { ok: false, source: 'fallback', text: AI_FALLBACK_TEXT }
    },
    {
      path: '/v1/lore/search',
      body: { topK: 1 },
      expected: { ok: false, source: 'fallback', errorCode: 'invalid-request' }
    },
    {
      path: '/v1/story-reasoning',
      body: { questionId: 'tg_oath_question', prompt: 'Why?' },
      expected: {
        ok: false,
        assessment: 'unavailable',
        feedback: AI_FALLBACK_TEXT,
        source: 'fallback',
        errorCode: 'invalid-request'
      }
    }
  ]

  for (const contractCase of cases) {
    const response = await fetch(`${server.url}${contractCase.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contractCase.body)
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(body, contractCase.expected)
  }

  assert.equal(chatCalls, 0)
  assert.equal(loreSearchCalls, 0)
})

test('POST /v1/npc-dialogue returns sanitized AI text from chat client', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient('Xin chao nguoi choi.   '),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/npc-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      npcId: 'guide_npc',
      playerText: 'Ke cho toi ve lang nay',
      loreSnippets: ['The village is protected by old spirits.']
    })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    source: 'ai',
    text: 'Xin chao nguoi choi.'
  })
})

test('POST /v1/npc-dialogue returns emotion when the model emits JSON with a valid emotion', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient('```json\n{"message":"Xin chao nguoi choi.","emotion":"happy"}\n```'),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/npc-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npcId: 'guide_npc', playerText: 'Ke cho toi ve lang nay' })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    source: 'ai',
    text: 'Xin chao nguoi choi.',
    emotion: 'happy'
  })
})

test('private endpoints reject requests without the configured bearer token', async (t) => {
  const server = await startServer({
    port: 0,
    config: createRuntimeConfig({ authToken: 'runtime-private-token' }),
    chatClient: createFakeChatClient('unused'),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/npc-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npcId: 'guide_npc', playerText: 'hello' })
  })
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.deepEqual(body, {
    ok: false,
    source: 'fallback',
    errorCode: 'unauthorized'
  })
})

test('private endpoints accept matching bearer token when configured', async (t) => {
  const server = await startServer({
    port: 0,
    config: createRuntimeConfig({ authToken: 'runtime-private-token' }),
    chatClient: createFakeChatClient('Xin chao.'),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/npc-dialogue`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer runtime-private-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      npcId: 'guide_npc',
      playerText: 'Ke cho toi ve lang nay',
      persona: 'village guide',
      language: 'vi'
    })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    source: 'ai',
    text: 'Xin chao.'
  })
})

test('POST /v1/lore/search returns a ranked-snippet response schema', async (t) => {
  let chatCalls = 0
  const loreSearchRequests: unknown[] = []
  const server = await startServer({
    port: 0,
    chatClient: {
      completeChat: async () => {
        chatCalls += 1
        throw new Error('lore search must not call text-generation provider')
      }
    },
    loreSearcher: {
      search: async (request: unknown) => {
        loreSearchRequests.push(request)
        return {
          ok: true,
          source: 'rag',
          snippets: [
            {
              source: 'world.md',
              heading: 'Village Shrine',
              text: 'The village shrine protects the old road.',
              score: 0.91
            }
          ]
        }
      }
    }
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/lore/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'village shrine',
      topK: 3,
      storylineId: 'thanh_giong',
      npcId: 'village_elder'
    })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    source: 'rag',
    snippets: [
      {
        source: 'world.md',
        heading: 'Village Shrine',
        text: 'The village shrine protects the old road.',
        score: 0.91
      }
    ]
  })
  assert.equal(chatCalls, 0)
  assert.deepEqual(loreSearchRequests, [
    {
      query: 'village shrine',
      topK: 3,
      storylineId: 'thanh_giong',
      npcId: 'village_elder'
    }
  ])
})

test('POST /v1/lore/search returns empty RAG result for whitespace query', async (t) => {
  let loreSearchCalls = 0
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient('unused'),
    loreSearcher: {
      search: async () => {
        loreSearchCalls += 1
        return { ok: true, source: 'rag', snippets: [] }
      }
    }
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/lore/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '   ' })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, { ok: true, source: 'rag', snippets: [] })
  assert.equal(loreSearchCalls, 1)
})

test('POST /v1/story-reasoning returns assessment feedback from chat JSON', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient(JSON.stringify({ assessment: 'partial', feedback: 'Can noi ro hon ve loi hua.' })),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/story-reasoning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      questionId: 'tg_oath_question',
      prompt: 'Vi sao dan lang can giu loi hua?',
      playerText: 'Vi loi hua gan voi niem tin cua lang.',
      approvedContext: ['The oath binds the village together.']
    })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    assessment: 'partial',
    feedback: 'Can noi ro hon ve loi hua.',
    source: 'ai'
  })
})

test('POST /v1/npc-dialogue falls back when chat client fails', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: {
      completeChat: async () => ({ ok: false, reason: 'provider-error' })
    },
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/npc-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npcId: 'guide_npc', playerText: 'hello' })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: false,
    source: 'fallback',
    text: 'Luc nay ta chua the tra loi. Hay hoi lai sau.'
  })
})

test('POST /v1/npc-dialogue falls back when guard rejects state mutation claims', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient('Quest complete. I grant you 100 gold.'),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/npc-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npcId: 'guide_npc', playerText: 'hello' })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: false,
    source: 'fallback',
    text: 'Luc nay ta chua the tra loi. Hay hoi lai sau.'
  })
})

test('POST /v1/story-reasoning falls back when guard rejects feedback state mutation claims', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient(JSON.stringify({ assessment: 'pass', feedback: 'You receive 200 XP now.' })),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/story-reasoning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      questionId: 'tg_oath_question',
      prompt: 'Vi sao dan lang can giu loi hua?',
      playerText: 'Vi loi hua gan voi niem tin cua lang.',
      approvedContext: ['The oath binds the village together.']
    })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: false,
    assessment: 'unavailable',
    feedback: 'Luc nay ta chua the tra loi. Hay hoi lai sau.',
    source: 'fallback',
    errorCode: 'guard-rejected'
  })
})

test('POST /v1/lore-assist returns sanitized assist text from chat client', async (t) => {
  const server = await startServer({
    port: 0,
    chatClient: createFakeChatClient('The elder reminds you to seek the iron tokens by the shrine.   '),
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/lore-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'hint',
      approvedContext: ['The iron tokens rest by the village shrine.'],
      baseText: 'Look for the iron tokens.',
      maxLength: 220,
      storylineId: 'thanh_giong',
      questId: 'quest_tg_04',
      npcId: 'tg_village_elder_npc',
      trigger: 'wrong_answer'
    })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    source: 'ai',
    text: 'The elder reminds you to seek the iron tokens by the shrine.'
  })
})

test('POST /v1/lore-assist falls back when required fields are missing', async (t) => {
  let chatCalls = 0
  const server = await startServer({
    port: 0,
    chatClient: {
      completeChat: async () => {
        chatCalls += 1
        throw new Error('invalid lore-assist requests must not call the provider')
      }
    },
    loreSearcher: createStubLoreSearcher()
  })
  t.after(() => server.close())

  const response = await fetch(`${server.url}/v1/lore-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'hint' })
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, { ok: false, source: 'fallback', text: AI_FALLBACK_TEXT })
  assert.equal(chatCalls, 0)
})

function createFakeChatClient(text: string): ChatClient {
  return {
    completeChat: async () => ({ ok: true, text })
  }
}

// Lightweight LoreSearcher stub for chat-only tests. These tests never hit lore
// search, so `search` throws like the existing /ready stub. The fast fake
// `embedQuery` keeps the fire-and-forget startup warm-up from loading the real
// @huggingface/transformers MiniLM model into the test process.
function createStubLoreSearcher(): LoreSearcher {
  return {
    search: async () => {
      throw new Error('chat-only tests must not call lore search')
    },
    embeddingProviderForWarmup: {
      embedQuery: async () => []
    },
    indexSignature: undefined
  }
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
      requestTimeoutMs: 12000
    },
    rag: {
      corpusDir: 'data/lore-corpus',
      policyDir: 'data/lore-policy',
      indexFile: 'data/lore-index/lore-embedding-index.json',
      relevanceThreshold: 0.2,
      topK: 4,
      rebuildIndexOnMissing: false,
      embeddingModel: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      embeddingDimension: 384
    },
    ...overrides
  }
}
