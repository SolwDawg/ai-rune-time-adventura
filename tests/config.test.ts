import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRuntimeConfig } from '../src/config.js'

test('parseRuntimeConfig uses local LM Studio defaults', () => {
  const config = parseRuntimeConfig({})

  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.port, 3100)
  assert.equal(config.llm.baseUrl, 'http://localhost:1234/v1')
  assert.equal(config.llm.apiKey, 'local-dev-key')
  assert.equal(config.llm.model, '')
  assert.equal(config.llm.requestTimeoutMs, 12000)
  assert.equal(config.llm.reasoningEffort, 'none')
  assert.equal(config.llm.logPayloadsEnabled, false)
  assert.equal(config.authToken, '')
  assert.equal(config.rag.corpusDir, 'data/lore-corpus')
  assert.equal(config.rag.policyDir, 'data/lore-policy')
  assert.equal(config.rag.indexFile, 'data/lore-index/lore-embedding-index.json')
  assert.equal(config.rag.relevanceThreshold, 0.2)
  assert.equal(config.rag.topK, 4)
  assert.equal(config.rag.rebuildIndexOnMissing, false)
  assert.equal(config.rag.embeddingModel, 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
  assert.equal(config.rag.embeddingDimension, 384)
})

test('parseRuntimeConfig accepts deployment overrides', () => {
  const config = parseRuntimeConfig({
    AI_RUNTIME_HOST: '0.0.0.0',
    AI_RUNTIME_PORT: '4100',
    AI_LLM_BASE_URL: 'https://ai.example.internal/v1',
    AI_LLM_MODEL: 'gemma-local',
    AI_LLM_API_KEY: 'private-key',
    AI_LLM_TIMEOUT_MS: '9000',
    AI_LLM_REASONING_EFFORT: 'low',
    AI_LLM_LOG_PAYLOADS: 'true',
    AI_RUNTIME_AUTH_TOKEN: 'runtime-private-token',
    RAG_CORPUS_DIR: 'runtime-data/corpus',
    RAG_POLICY_DIR: 'runtime-data/policy',
    RAG_INDEX_FILE: 'runtime-data/index.json',
    RAG_RELEVANCE_THRESHOLD: '0.42',
    RAG_TOP_K: '6',
    RAG_REBUILD_INDEX_ON_MISSING: 'true',
    RAG_EMBEDDING_MODEL: 'custom/multilingual-model',
    RAG_EMBEDDING_DIMENSION: '768'
  })

  assert.equal(config.host, '0.0.0.0')
  assert.equal(config.port, 4100)
  assert.equal(config.llm.baseUrl, 'https://ai.example.internal/v1')
  assert.equal(config.llm.model, 'gemma-local')
  assert.equal(config.llm.apiKey, 'private-key')
  assert.equal(config.llm.requestTimeoutMs, 9000)
  assert.equal(config.llm.reasoningEffort, 'low')
  assert.equal(config.llm.logPayloadsEnabled, true)
  assert.equal(config.authToken, 'runtime-private-token')
  assert.equal(config.rag.corpusDir, 'runtime-data/corpus')
  assert.equal(config.rag.policyDir, 'runtime-data/policy')
  assert.equal(config.rag.indexFile, 'runtime-data/index.json')
  assert.equal(config.rag.relevanceThreshold, 0.42)
  assert.equal(config.rag.topK, 6)
  assert.equal(config.rag.rebuildIndexOnMissing, true)
  assert.equal(config.rag.embeddingModel, 'custom/multilingual-model')
  assert.equal(config.rag.embeddingDimension, 768)
})
