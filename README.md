# Adventura AI Runtime

Private AI runtime service for Adventura backend LLM and RAG workloads.

## Role

This service is server-side only. Unity must not call it directly.

```text
Unity Client
  -> Adventura-backend
    -> Adventura-ai-runtime
      -> LM Studio / hosted LLM / future RAG
```

`Adventura-backend` remains authoritative for auth, gameplay, quest progress,
rewards, inventory, combat, enemy state, storyline assignment, and unlocks.
This service only returns AI text or retrieval results.

## Current API

```text
GET  /health
GET  /ready
POST /v1/npc-dialogue
POST /v1/lore/search
POST /v1/story-reasoning
```

Private endpoints enforce `Authorization: Bearer <AI_RUNTIME_AUTH_TOKEN>` when
`AI_RUNTIME_AUTH_TOKEN` is configured. `GET /health` remains unauthenticated for
infrastructure probes. `GET /ready` is also unauthenticated and reports cheap
configuration readiness for optional LLM/RAG dependencies without calling text
generation or retrieval providers.

`GET /ready` returns:

```json
{
  "status": "ok",
  "service": "adventura-ai-runtime",
  "dependencies": {
    "llm": { "ready": true },
    "rag": { "ready": true }
  }
}
```

When a dependency is not configured, `status` becomes `degraded` and the
dependency includes a non-secret `reason`.

`POST /v1/npc-dialogue` accepts:

```json
{
  "npcId": "guide_npc",
  "playerText": "Ke cho toi ve lang nay",
  "loreSnippets": ["Optional grounded lore text"],
  "persona": "Optional NPC persona",
  "language": "vi"
}
```

It returns either:

```json
{ "ok": true, "source": "ai", "text": "..." }
```

or a safe fallback:

```json
{
  "ok": false,
  "source": "fallback",
  "text": "Luc nay ta chua the tra loi. Hay hoi lai sau."
}
```

`POST /v1/lore/search` accepts:

```json
{
  "query": "village shrine",
  "topK": 3,
  "storylineId": "thanh_giong",
  "npcId": "village_elder"
}
```

It returns ranked snippets:

```json
{
  "ok": true,
  "source": "rag",
  "snippets": [
    {
      "source": "storyline:thanh_giong",
      "heading": "Village shrine",
      "text": "Grounded lore text",
      "score": 0.91
    }
  ]
}
```

`POST /v1/story-reasoning` accepts:

```json
{
  "questionId": "tg_oath_question",
  "prompt": "Vi sao dan lang can giu loi hua?",
  "playerText": "Vi loi hua gan voi niem tin cua lang.",
  "approvedContext": ["The oath binds the village together."],
  "rubric": ["Optional private grading criteria, never revealed to the player."]
}
```

It returns AI assessment feedback or a fallback:

```json
{
  "ok": true,
  "assessment": "partial",
  "feedback": "Can noi ro hon ve loi hua.",
  "source": "ai"
}
```

## Provider and Guard

LLM calls use the OpenAI-compatible `POST /chat/completions` shape against
`AI_LLM_BASE_URL`, so the local default works with LM Studio and hosted
OpenAI-compatible gateways without provider SDKs. If `AI_LLM_MODEL` is empty,
the runtime fails safely without calling the provider.

Player-visible AI text passes through the output guard before it leaves this
service. The guard normalizes whitespace and falls back when output is empty,
too long, contains configured forbidden phrases, references real-world history,
or claims to change gameplay state such as rewards, quests, inventory, or
combat.

## Local Setup

Install dependencies:

```powershell
npm install
```

Copy `.env.example` into `.env` and set the model id currently loaded in LM
Studio.

Run tests:

```powershell
npm test
```

Build:

```powershell
npm run build
```

Start:

```powershell
npm start
```

Default local LLM endpoint:

```text
http://localhost:1234/v1
```

Build the semantic lore index after changing corpus or policy files:

```powershell
npm run build:rag-index
```

`RAG_CORPUS_DIR` contains retrievable lore. `RAG_POLICY_DIR` contains forbidden
phrases and policy text and is never returned by `/v1/lore/search`. If an index
is missing or invalid and `RAG_REBUILD_INDEX_ON_MISSING=false`, lore search
returns `rag-index-unavailable` so the backend can fall back safely.

## Local Startup Order

Start local services in this order:

1. LM Studio or another OpenAI-compatible model server on `localhost:1234`.
2. `Adventura-ai-runtime` on `127.0.0.1:3100`.
3. `Adventura-backend`, with `AI_RUNTIME_BASE_URL=http://127.0.0.1:3100`.
4. Unity client.

The backend remains the only service Unity calls. AI runtime can be stopped and
restarted independently; backend AI calls fall back while it is unavailable.

## PowerShell Smoke Checks

Check LM Studio:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:1234/v1/models'

$chatBody = @{
  model = $env:AI_LLM_MODEL
  messages = @(@{ role = 'user'; content = 'ping' })
  max_tokens = 8
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri 'http://127.0.0.1:1234/v1/chat/completions' -Method Post -ContentType 'application/json' -Body $chatBody
```

Check AI runtime:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3100/health'
Invoke-RestMethod -Uri 'http://127.0.0.1:3100/ready'

$headers = @{}
if ($env:AI_RUNTIME_AUTH_TOKEN) {
  $headers.Authorization = "Bearer $env:AI_RUNTIME_AUTH_TOKEN"
}

$dialogueBody = @{
  npcId = 'guide_npc'
  playerText = 'hello'
  loreSnippets = @('local smoke')
  language = 'vi'
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri 'http://127.0.0.1:3100/v1/npc-dialogue' -Method Post -Headers $headers -ContentType 'application/json' -Body $dialogueBody
```

## Deployment Notes

- Run `Adventura-backend` and `Adventura-ai-runtime` as separate processes.
- Put `Adventura-ai-runtime` on the AI/GPU/model side of the deployment.
- Put gameplay database and Redis access only on `Adventura-backend`.
- Inject real `AI_LLM_API_KEY` and `AI_RUNTIME_AUTH_TOKEN` through environment or secret management, not committed files.
- Runtime logs and backend logs may include endpoint category, failure reason, status, and latency; they must not include provider keys, bearer tokens, or request payloads.
- Restarting AI runtime must not require restarting backend. Existing backend calls should use fallback behavior until the runtime is reachable again.

## Environment

| Name | Default | Purpose |
| --- | --- | --- |
| `AI_RUNTIME_PORT` | `3100` | HTTP port for this private runtime. |
| `AI_RUNTIME_AUTH_TOKEN` | empty | Optional bearer token required by private endpoints when set. |
| `AI_LLM_BASE_URL` | `http://localhost:1234/v1` | OpenAI-compatible LLM endpoint. |
| `AI_LLM_MODEL` | empty | Model id loaded by LM Studio or a hosted LLM server. |
| `AI_LLM_API_KEY` | `local-dev-key` | Local/provider API key. Do not commit real keys. |
| `AI_LLM_TIMEOUT_MS` | `12000` | Provider timeout for AI text generation. |
| `RAG_CORPUS_DIR` | `data/lore-corpus` | Retrievable lore markdown corpus. |
| `RAG_POLICY_DIR` | `data/lore-policy` | Policy markdown and forbidden phrases, excluded from retrieval. |
| `RAG_INDEX_FILE` | `data/lore-index/lore-embedding-index.json` | Serialized embedding index. |
| `RAG_RELEVANCE_THRESHOLD` | `0.2` | Minimum cosine score returned by lore search. |
| `RAG_TOP_K` | `4` | Default lore search result count. |
| `RAG_REBUILD_INDEX_ON_MISSING` | `false` | Rebuild from corpus when index is missing or invalid. |
| `RAG_EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Local multilingual embedding model for Vietnamese-capable retrieval. |
| `RAG_EMBEDDING_DIMENSION` | `384` | Expected embedding vector dimension. |
