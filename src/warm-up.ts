import type { ChatClient } from './llm-client.js'
import type { EmbeddingProvider } from './rag/embedding-provider.js'

export interface WarmUpDependencies {
  readonly embeddingProvider?: Pick<EmbeddingProvider, 'embedQuery'>
  readonly chatClient?: Pick<ChatClient, 'completeChat'>
  readonly logger?: { info(message: string): void; warn(message: string): void }
}

export interface WarmUpConfig {
  readonly ragConfigured: boolean
  readonly llmConfigured: boolean
  readonly llmWarmupEnabled: boolean
}

/**
 * Best-effort startup warm-up. Always resolves and never throws (Req 4.4): each
 * step is independently try/caught and only category/outcome/latency is logged —
 * never query text, tokens, or secrets (Req 6.5). It pre-loads the embedding
 * pipeline whenever RAG is configured (Req 4.1) and issues a tiny LLM probe only
 * when LLM is configured AND warm-up is enabled (Req 4.2). Steps are skipped when
 * the corresponding configuration is absent (Req 4.5). It never gates `/ready`
 * (Req 4.6) because it is invoked fire-and-forget after `listen`.
 */
export async function warmUp(cfg: WarmUpConfig, deps: WarmUpDependencies): Promise<void> {
  const logger = deps.logger ?? console

  if (cfg.ragConfigured && deps.embeddingProvider) {
    try {
      const started = Date.now()
      await deps.embeddingProvider.embedQuery('warmup') // Req 4.1 — preloads transformers model
      logger.info(`[warmup] embedding ok latencyMs=${Date.now() - started}`)
    } catch {
      logger.warn('[warmup] embedding failed; continuing') // Req 4.4
    }
  } // Req 4.5: skipped when RAG not configured

  if (cfg.llmConfigured && cfg.llmWarmupEnabled && deps.chatClient) {
    try {
      const started = Date.now()
      await deps.chatClient.completeChat({ systemPrompt: 'warmup', userMessage: 'warmup', maxTokens: 1 }) // Req 4.2
      logger.info(`[warmup] llm ok latencyMs=${Date.now() - started}`)
    } catch {
      logger.warn('[warmup] llm failed; continuing') // Req 4.4
    }
  } // Req 4.5: skipped when LLM not configured or warm-up disabled
}
