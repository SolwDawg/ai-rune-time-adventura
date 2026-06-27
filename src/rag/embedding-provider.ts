export interface EmbeddingProvider {
  readonly dimension: number
  embedQuery(text: string): Promise<number[]>
  embedDocuments(texts: readonly string[]): Promise<readonly number[][]>
}

export interface TransformersEmbeddingProviderOptions {
  readonly model: string
  readonly dimension: number
}

type FeatureExtractionPipeline = (
  input: string | readonly string[],
  options: { readonly pooling: 'mean'; readonly normalize: boolean }
) => Promise<unknown>

type TransformersModule = {
  pipeline(task: 'feature-extraction', model: string): Promise<FeatureExtractionPipeline>
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number
  private readonly model: string
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

  constructor(options: TransformersEmbeddingProviderOptions) {
    if (!Number.isSafeInteger(options.dimension) || options.dimension <= 0) {
      throw new Error('Embedding dimension must be a positive integer.')
    }

    this.model = options.model
    this.dimension = options.dimension
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedDocuments([text])
    return vectors[0]
  }

  async embedDocuments(texts: readonly string[]): Promise<readonly number[][]> {
    if (texts.length === 0) {
      return []
    }

    const pipeline = await this.getPipeline()
    const output = await pipeline(texts, { pooling: 'mean', normalize: true })
    const vectors = tensorToVectors(output)

    for (const vector of vectors) {
      assertVectorDimension(vector, this.dimension)
    }

    return vectors
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    this.pipelinePromise ??= loadTransformersPipeline(this.model)
    return this.pipelinePromise
  }
}

async function loadTransformersPipeline(model: string): Promise<FeatureExtractionPipeline> {
  const transformers = (await import('@huggingface/transformers')) as unknown as TransformersModule
  return transformers.pipeline('feature-extraction', model)
}

function tensorToVectors(output: unknown): number[][] {
  const tensor = output as {
    readonly data?: ArrayLike<number>
    readonly dims?: readonly number[]
    tolist?: () => unknown
  }

  const listed = tensor.tolist?.()
  if (Array.isArray(listed) && listed.every((entry) => Array.isArray(entry))) {
    return listed.map((entry) => entry.map(Number))
  }

  if (Array.isArray(listed) && listed.every((entry) => typeof entry === 'number')) {
    return [listed.map(Number)]
  }

  if (!tensor.data || !tensor.dims || tensor.dims.length < 2) {
    throw new Error('Embedding provider returned unsupported tensor output.')
  }

  const count = tensor.dims[0]
  const dimension = tensor.dims[tensor.dims.length - 1]
  const vectors: number[][] = []
  for (let row = 0; row < count; row += 1) {
    const start = row * dimension
    const vector: number[] = []
    for (let column = 0; column < dimension; column += 1) {
      vector.push(Number(tensor.data[start + column]))
    }
    vectors.push(vector)
  }

  return vectors
}

function assertVectorDimension(vector: readonly number[], dimension: number): void {
  if (vector.length !== dimension || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding vector dimension mismatch. Expected ${dimension}, got ${vector.length}.`)
  }
}
