import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { normalizeText } from './normalize.js'

export interface LoreCorpusChunk {
  readonly id: string
  readonly source: string
  readonly heading: string
  readonly text: string
  readonly storylineId?: string
  readonly npcId?: string
  readonly questId?: string
}

export interface PolicyStore {
  readonly forbiddenPhrases: readonly string[]
  readonly policyText: readonly string[]
}

export interface LoadedLoreCorpus {
  readonly chunks: readonly LoreCorpusChunk[]
  readonly policy: PolicyStore
}

export interface LoreCorpusLogger {
  warn(message: string): void
}

export interface LoadLoreCorpusOptions {
  readonly corpusDir: string
  readonly policyDir: string
  readonly logger?: LoreCorpusLogger
}

interface MarkdownMetadata {
  readonly storylineId?: string
  readonly npcId?: string
  readonly questId?: string
}

export function loadLoreCorpus(options: LoadLoreCorpusOptions): LoadedLoreCorpus {
  const policy = loadPolicyStore(options.policyDir)
  const policyFileNames = new Set(listMarkdownFiles(options.policyDir))
  const chunks: LoreCorpusChunk[] = []

  for (const fileName of listMarkdownFiles(options.corpusDir)) {
    if (policyFileNames.has(fileName) || isPolicyFileName(fileName)) {
      options.logger?.warn(`Skipping policy file from corpus: ${fileName}`)
      continue
    }

    const content = readFileSync(join(options.corpusDir, fileName), 'utf8')
    chunks.push(...splitMarkdown(fileName, normalizeText(content)))
  }

  return { chunks, policy }
}

function loadPolicyStore(policyDir: string): PolicyStore {
  const forbiddenPhrases: string[] = []
  const policyText: string[] = []

  for (const fileName of listMarkdownFiles(policyDir)) {
    const content = normalizeText(readFileSync(join(policyDir, fileName), 'utf8'))
    policyText.push(content)
    forbiddenPhrases.push(...extractForbiddenPhrases(content))
  }

  return { forbiddenPhrases, policyText }
}

function listMarkdownFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
}

function splitMarkdown(source: string, content: string): LoreCorpusChunk[] {
  const { metadata, body } = readFrontMatter(content)
  const chunks: LoreCorpusChunk[] = []
  const usedIds = new Map<string, number>()
  const lines = body.split(/\r?\n/)
  let heading = 'Introduction'
  let textLines: string[] = []

  const flush = () => {
    const text = textLines.join('\n').trim()
    if (!text) {
      textLines = []
      return
    }

    const baseId = `${source}#${slugify(heading)}`
    const count = usedIds.get(baseId) ?? 0
    usedIds.set(baseId, count + 1)
    chunks.push({
      id: count === 0 ? baseId : `${baseId}-${count + 1}`,
      source,
      heading,
      text,
      ...metadata
    })
    textLines = []
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (headingMatch) {
      flush()
      heading = headingMatch[1]
      continue
    }

    textLines.push(line)
  }

  flush()
  return chunks
}

function readFrontMatter(content: string): { readonly metadata: MarkdownMetadata; readonly body: string } {
  if (!content.startsWith('---\n')) {
    return { metadata: {}, body: content }
  }

  const end = content.indexOf('\n---\n', 4)
  if (end === -1) {
    return { metadata: {}, body: content }
  }

  const metadataText = content.slice(4, end)
  const metadata: { storylineId?: string; npcId?: string; questId?: string } = {}
  for (const line of metadataText.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/)
    if (!match) {
      continue
    }

    if (match[1] === 'storylineId') {
      metadata.storylineId = match[2]
    }

    if (match[1] === 'npcId') {
      metadata.npcId = match[2]
    }

    if (match[1] === 'questId') {
      metadata.questId = match[2]
    }
  }

  return { metadata, body: content.slice(end + 5) }
}

function extractForbiddenPhrases(content: string): string[] {
  const phrases: string[] = []
  let inForbiddenPhrases = false

  for (const line of content.split(/\r?\n/)) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (headingMatch) {
      inForbiddenPhrases = headingMatch[1].trim().toLowerCase() === 'forbidden phrases'
      continue
    }

    const phrase = line.trim()
    if (inForbiddenPhrases && phrase) {
      phrases.push(phrase)
    }
  }

  return phrases
}

function isPolicyFileName(fileName: string): boolean {
  return /(?:forbidden|policy)/i.test(fileName)
}

function slugify(value: string): string {
  const stripped = value
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'section'
}
