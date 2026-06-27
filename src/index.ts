import { parseRuntimeConfig } from './config.js'
import { startServer } from './server.js'

const config = parseRuntimeConfig()
const server = await startServer({ config })

console.log(`[adventura-ai-runtime] listening on ${server.url}`)
