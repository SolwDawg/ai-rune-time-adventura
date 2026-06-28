import assert from 'node:assert/strict'
import test from 'node:test'

import type { RuntimeConfig } from '../src/config.js'
import { buildReadiness } from '../src/server.js'
import { warmUp, type WarmUpConfig, type WarmUpDependencies } from '../src/warm-up.js'
import { forAll, genMap, genOneOf } from './helpers/gen.js'

// Feature: ai-runtime-performance, Property 10
// Validates: Requirements 4.1, 4.2, 4.4, 4.5, 4.6, 6.1
//
// Warm-up never throws and never gates readiness: over every combination of
// config flags and throwing probes, warmUp resolves, runs the embedding step iff
// RAG is configured, runs the LLM step iff LLM is configured and enabled, and the
// value returned by buildReadiness is unaffected by whether warmUp ran or failed.

interface Scenario {
  readonly ragConfigured: boolean
  readonly llmConfigured: boolean
  readonly llmWarmupEnabled: boolean
  readonly embeddingThrows: boolean
  readonly chatThrows: boolean
}

const genBool = genOneOf(true, false)

const genScenario = genMap(
  // Pack five independent booleans into one sample via a 5-bit integer so each
  // flag combination is reachable.
  genOneOf(...Array.from({ length: 32 }, (_unused, i) => i)),
  (bits): Scenario => ({
    ragConfigured: Boolean(bits & 1),
    llmConfigured: Boolean(bits & 2),
    llmWarmupEnabled: Boolean(bits & 4),
    embeddingThrows: Boolean(bits & 8),
    chatThrows: Boolean(bits & 16)
  })
)

// Touch genBool so the helper import is exercised even though genScenario packs bits.
void genBool

const silentLogger = { info: () => {}, warn: () => {} }

function buildConfig(scenario: Scenario): RuntimeConfig {
  return {
    port: 0,
    authToken: '',
    llm: {
      baseUrl: 'http://localhost:1234/v1',
      model: scenario.llmConfigured ? 'test-model' : '',
      apiKey: 'local-dev-key',
      requestTimeoutMs: 12000,
      reasoningEffort: 'none',
      warmupEnabled: scenario.llmWarmupEnabled
    },
    rag: {
      corpusDir: scenario.ragConfigured ? 'data/lore-corpus' : '',
      policyDir: 'data/lore-policy',
      indexFile: scenario.ragConfigured ? 'data/lore-index/lore-embedding-index.json' : '',
      relevanceThreshold: 0.2,
      topK: 4,
      rebuildIndexOnMissing: false,
      embeddingModel: scenario.ragConfigured ? 'minilm' : '',
      embeddingDimension: 384,
      embeddingCacheMax: 256
    }
  }
}

test('Property 10: warm-up never throws and never gates readiness', async () => {
  // node:test does not let `forAll` await inside the predicate, so collect the
  // async scenarios synchronously and await them all.
  const scenarios: Scenario[] = []
  forAll(120, genScenario, (scenario) => {
    scenarios.push(scenario)
  })

  for (const scenario of scenarios) {
    let embedCalls = 0
    let chatCalls = 0

    const deps: WarmUpDependencies = {
      logger: silentLogger,
      embeddingProvider: {
        async embedQuery() {
          embedCalls += 1
          if (scenario.embeddingThrows) {
            throw new Error('embedding probe failed')
          }
          return [0.1, 0.2, 0.3]
        }
      },
      chatClient: {
        async completeChat() {
          chatCalls += 1
          if (scenario.chatThrows) {
            throw new Error('chat probe failed')
          }
          return { ok: true, text: 'ok' }
        }
      }
    }

    const cfg: WarmUpConfig = {
      ragConfigured: scenario.ragConfigured,
      llmConfigured: scenario.llmConfigured,
      llmWarmupEnabled: scenario.llmWarmupEnabled
    }

    const config = buildConfig(scenario)
    const readinessBefore = buildReadiness(config, scenario.ragConfigured ? 'idx_abc' : undefined)

    // warmUp must always resolve, never reject (Req 4.4, 6.1).
    const result = await warmUp(cfg, deps)
    assert.equal(result, undefined)

    // Embedding step runs iff RAG configured (Req 4.1, 4.5).
    assert.equal(embedCalls, scenario.ragConfigured ? 1 : 0)
    // LLM step runs iff LLM configured AND warm-up enabled (Req 4.2, 4.5).
    assert.equal(chatCalls, scenario.llmConfigured && scenario.llmWarmupEnabled ? 1 : 0)

    // Readiness is independent of whether warmUp ran or failed (Req 4.6).
    const readinessAfter = buildReadiness(config, scenario.ragConfigured ? 'idx_abc' : undefined)
    assert.deepEqual(readinessAfter, readinessBefore)
  }
})
