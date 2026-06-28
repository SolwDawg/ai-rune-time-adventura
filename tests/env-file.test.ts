import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { loadRuntimeEnvFile } from '../src/env-file.js'

test('loadRuntimeEnvFile ignores a missing env file', () => {
  assert.doesNotThrow(() => loadRuntimeEnvFile(join(tmpdir(), 'missing-adventura-ai-runtime.env')))
})

test('loadRuntimeEnvFile loads values from an env file without overriding existing process env', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'adventura-ai-runtime-env-'))
  const envFile = join(tempDir, '.env')
  const loadedKey = 'AI_RUNTIME_TEST_LOAD_FROM_FILE'
  const existingKey = 'AI_RUNTIME_TEST_KEEP_EXISTING'
  const previousLoaded = process.env[loadedKey]
  const previousExisting = process.env[existingKey]

  try {
    delete process.env[loadedKey]
    process.env[existingKey] = 'from-process'
    await writeFile(envFile, `${loadedKey}=from-file\n${existingKey}=from-file\n`, 'utf8')

    loadRuntimeEnvFile(envFile)

    assert.equal(process.env[loadedKey], 'from-file')
    assert.equal(process.env[existingKey], 'from-process')
  } finally {
    restoreEnv(loadedKey, previousLoaded)
    restoreEnv(existingKey, previousExisting)
    await rm(tempDir, { recursive: true, force: true })
  }
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
