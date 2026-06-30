import type { NpcDialogueRequest } from "../contracts.js";
import type { ChatCompletionRequest } from "../llm-client.js";

export function buildNpcDialoguePrompt(
  request: NpcDialogueRequest,
): ChatCompletionRequest {
  if (request.mode === "chatbot") {
    return buildPlainChatbotPrompt(request);
  }

  return {
    systemPrompt: buildNpcDialogueSystemPrompt(request),
    userMessage: buildNpcDialogueUserMessage(request),
    // Reasoning is disabled by default (config reasoningEffort=none), so a modest
    // budget covers the short in-world reply; raise if reasoning is re-enabled.
    maxTokens: 320,
    temperature: 0.35,
  };
}

function buildPlainChatbotPrompt(request: NpcDialogueRequest): ChatCompletionRequest {
  const prompt = [
    "You are a helpful AI chatbot.",
    "Answer the user's message directly.",
    "Do not roleplay as an Adventura NPC.",
    "Do not process Adventura storyline, quest, reward, inventory, combat, or mood-label state.",
    "Return plain text only. Do not return JSON.",
  ];

  if (request.language) {
    prompt.push(`Language: ${request.language}`);
  }

  return {
    systemPrompt: prompt.join("\n"),
    userMessage: request.playerText,
    maxTokens: 320,
    temperature: 0.35,
  };
}

function buildNpcDialogueSystemPrompt(request: NpcDialogueRequest): string {
  const prompt = [
    "You are an Adventura NPC dialogue assistant.",
    "Answer only as in-world NPC dialogue.",
    "Use only the grounded lore snippets supplied by the gameplay backend.",
    "Keep the reply focused on the player's immediate intent.",
    "If the player greets the NPC, greet them back first in the NPC persona, then add at most one short in-world guidance sentence.",
    "Do not turn a greeting into suspicion, interrogation, accusation, or a new objective.",
    "Do not grant rewards, complete quests, mutate inventory, or override server state.",
    'Return strict JSON with a required "message" field and an optional "emotion" field.',
    "The emotion field, when present, must be exactly one of: neutral, happy, worried, serious, angry, sad.",
    "Output only the raw JSON object with no markdown code fences and no extra text.",
    `NPC id: ${request.npcId}`,
  ];

  if (request.persona) {
    prompt.push(`Persona: ${request.persona}`);
  }

  if (request.language) {
    prompt.push(`Language: ${request.language}`);
  }

  return prompt.join("\n");
}

function buildNpcDialogueUserMessage(request: NpcDialogueRequest): string {
  const lore = request.loreSnippets?.length
    ? request.loreSnippets.join("\n---\n")
    : "No grounded lore snippets.";
  return [
    `Player text: ${request.playerText}`,
    "Grounded lore snippets:",
    lore,
  ].join("\n\n");
}
