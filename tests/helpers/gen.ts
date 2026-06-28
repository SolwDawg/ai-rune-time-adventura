// Hand-rolled, seeded property-test generators for node:test.
//
// Uses only Node built-ins and node:test/node:assert. NO external dependency
// (this repo deliberately does not add fast-check). The generators are
// deterministic for a given seed so any counterexample is reproducible.

import assert from 'node:assert/strict'

export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number
}

export type Gen<T> = (rng: Rng) => T

/** Default number of iterations for property runs (>= 100 per design). */
export const DEFAULT_RUNS = 100

/** mulberry32 PRNG: tiny, fast, deterministic, good enough for property tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed)
  return {
    next,
    int(min: number, max: number): number {
      if (max < min) {
        ;[min, max] = [max, min]
      }
      return min + Math.floor(next() * (max - min + 1))
    }
  }
}

/** Integer generator in [min, max] inclusive. */
export function genInt(min: number, max: number): Gen<number> {
  return (rng) => rng.int(min, max)
}

const STRING_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.' + 'àáảãạăâđêôơưèéĐ'

export interface StringGenOptions {
  readonly minLength?: number
  readonly maxLength?: number
  /** Characters to draw from. Defaults to a mixed ascii + Vietnamese set. */
  readonly alphabet?: string
}

/** Random string generator over a configurable alphabet (never contains \u0000). */
export function genString(options: StringGenOptions = {}): Gen<string> {
  const minLength = options.minLength ?? 0
  const maxLength = options.maxLength ?? 24
  const alphabet = options.alphabet ?? STRING_ALPHABET
  return (rng) => {
    const length = rng.int(minLength, maxLength)
    let out = ''
    for (let i = 0; i < length; i += 1) {
      out += alphabet[rng.int(0, alphabet.length - 1)]
    }
    return out
  }
}

/** Float vector generator with a fixed or random dimension. */
export function genFloatVector(options: { readonly dimension?: number; readonly maxDimension?: number } = {}): Gen<number[]> {
  return (rng) => {
    const dimension = options.dimension ?? rng.int(1, options.maxDimension ?? 8)
    const vector: number[] = []
    for (let i = 0; i < dimension; i += 1) {
      // Spread across negatives/positives with some magnitude.
      vector.push((rng.next() - 0.5) * 20)
    }
    return vector
  }
}

/** Array generator of length in [minLength, maxLength]. */
export function genArrayOf<T>(item: Gen<T>, minLength: number, maxLength: number): Gen<T[]> {
  return (rng) => {
    const length = rng.int(minLength, maxLength)
    const out: T[] = []
    for (let i = 0; i < length; i += 1) {
      out.push(item(rng))
    }
    return out
  }
}

/** A single cache-style operation in a generated operation sequence. */
export interface Op<K = string> {
  readonly kind: 'set' | 'get'
  readonly key: K
}

export interface OpsGenOptions {
  /** Minimum number of operations in the sequence (default 0). */
  readonly minLength?: number
  /** Maximum number of operations in the sequence (default 40). */
  readonly maxLength?: number
  /** Number of distinct keys to draw from (default 8). Keys are `k0..k{n-1}`. */
  readonly keyPoolSize?: number
  /** Probability in [0, 1] that an op is a `set` rather than a `get` (default 0.7). */
  readonly setBias?: number
}

/**
 * Operation-sequence generator: produces a list of `{ kind, key }` ops over a
 * bounded key pool, biased toward `set`. Useful for exercising stateful
 * structures (e.g. LRU caches) across many randomized histories.
 */
export function genOps(options: OpsGenOptions = {}): Gen<Op[]> {
  const minLength = options.minLength ?? 0
  const maxLength = options.maxLength ?? 40
  const keyPoolSize = Math.max(1, options.keyPoolSize ?? 8)
  const setBias = options.setBias ?? 0.7
  return (rng) => {
    const length = rng.int(minLength, maxLength)
    const ops: Op[] = []
    for (let i = 0; i < length; i += 1) {
      ops.push({
        kind: rng.next() < setBias ? 'set' : 'get',
        key: `k${rng.int(0, keyPoolSize - 1)}`
      })
    }
    return ops
  }
}

/** Picks one of the provided values uniformly at random. */
export function genOneOf<T>(...values: readonly T[]): Gen<T> {
  if (values.length === 0) {
    throw new Error('genOneOf requires at least one value')
  }
  return (rng) => values[rng.int(0, values.length - 1)]
}

/** Maps a generator's output through a transform. */
export function genMap<A, B>(gen: Gen<A>, transform: (value: A) => B): Gen<B> {
  return (rng) => transform(gen(rng))
}

/**
 * Runs `predicate` against `runs` generated samples (default >= 100). The
 * predicate may return `false` or throw to signal failure. On failure the seed,
 * iteration index, and the failing sample are reported for reproducibility.
 */
export function forAll<T>(runs: number, gen: Gen<T>, predicate: (value: T) => boolean | void): void {
  const iterations = Math.max(runs, DEFAULT_RUNS)
  for (let i = 0; i < iterations; i += 1) {
    const seed = (i + 1) * 0x9e3779b1
    const rng = createRng(seed)
    const sample = gen(rng)
    try {
      const result = predicate(sample)
      if (result === false) {
        assert.fail(`Property failed (iteration ${i}, seed ${seed}) for sample: ${safeStringify(sample)}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        error.message = `Property failed (iteration ${i}, seed ${seed}) for sample: ${safeStringify(sample)}\n${error.message}`
      }
      throw error
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
