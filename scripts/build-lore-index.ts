import { parseRuntimeConfig } from '../src/config.js'
import { TransformersEmbeddingProvider } from '../src/rag/embedding-provider.js'
import { rebuildIndexFromCorpus } from '../src/rag/lore-search-service.js'

const config = parseRuntimeConfig().rag
const provider = new TransformersEmbeddingProvider({
  model: config.embeddingModel,
  dimension: config.embeddingDimension
})

await rebuildIndexFromCorpus(config, provider)
console.log(`Wrote lore embedding index to ${config.indexFile}`)
