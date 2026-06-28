import { parseRuntimeConfig } from './config.js'
import { loadRuntimeEnvFile } from './env-file.js'
import { startServer } from './server.js'

loadRuntimeEnvFile()

const config = parseRuntimeConfig()
const server = await startServer({ config })

console.log(`[adventura-ai-runtime] listening on ${server.url}`)
