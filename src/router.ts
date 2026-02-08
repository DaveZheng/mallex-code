/**
 * Intent classification and routing logic.
 * Classifies user requests and routes them to local MLX or Claude API.
 */

import type { IntentCategory, ModelTierNumber, RoutingConfig, RoutingRule, TierModel } from "./config.js";
import { chatCompletion } from "./client.js";
import type { OpenAIChatRequest, OpenAIChatResponse } from "./client.js";
import type { AnthropicMessage } from "./translate-request.js";

const VALID_CATEGORIES: IntentCategory[] = ["chit_chat", "simple_code", "hard_question", "try_again"];

const CLASSIFICATION_PROMPT = `Classify this user message into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- chit_chat: casual conversation, explanations, Q&A (not writing/editing code)
- simple_code: single-file edits, small features, renames, fixing imports/typos
- hard_question: multi-file refactors, architecture, planning, complex debugging, system design
- try_again: user says the previous answer was wrong, incomplete, or asks to redo

User message:
`;

/** Module-level state for try_again escalation. */
let lastRequestTier: ModelTierNumber = 1;

/** Reset lastRequestTier to 1. Exported for testing. */
export function resetLastRequestTier(): void {
  lastRequestTier = 1;
}

/**
 * Walk messages backwards to find the last user message text.
 * If content is a string, return it. If it's an array, find text blocks
 * (skip tool_result blocks). Truncate to 500 chars.
 */
export function extractLatestUserText(messages: AnthropicMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    if (typeof msg.content === "string") {
      return msg.content.slice(0, 500);
    }

    // Content is an array of blocks — collect text blocks, skip tool_result
    const textParts: string[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      }
      // Skip tool_result and tool_use blocks
    }
    if (textParts.length > 0) {
      return textParts.join("\n").slice(0, 500);
    }
  }
  return "";
}

/**
 * Fuzzy-match a raw model response to a valid IntentCategory.
 * Handles common variations; defaults to simple_code on unknown input.
 */
export function parseCategory(raw: string): IntentCategory {
  const lower = raw.trim().toLowerCase();

  // Exact match
  for (const cat of VALID_CATEGORIES) {
    if (lower === cat) return cat;
  }

  // Fuzzy prefix/keyword matching
  if (lower.includes("chit")) return "chit_chat";
  if (lower.includes("simple")) return "simple_code";
  if (lower.includes("hard") || lower.includes("complex")) return "hard_question";
  if (lower.includes("try")) return "try_again";

  return "simple_code";
}

/**
 * Classify a user message by sending it to the local MLX model.
 * Returns one of the four IntentCategory values.
 * On any error, defaults to simple_code.
 */
export async function classifyIntent(
  userText: string,
  model: string,
  serverPort: number,
  deps: { chatCompletion: typeof chatCompletion } = { chatCompletion },
): Promise<IntentCategory> {
  try {
    const body: OpenAIChatRequest = {
      model,
      messages: [
        { role: "user", content: CLASSIFICATION_PROMPT + userText },
      ],
      max_tokens: 20,
      temperature: 0.0,
      top_p: 1.0,
      stream: false,
    };

    const response: OpenAIChatResponse = await deps.chatCompletion(body, serverPort);
    const raw = response.choices[0]?.message?.content ?? "";
    return parseCategory(raw);
  } catch {
    return "simple_code";
  }
}

export interface RouteResult {
  tier: ModelTierNumber;
  intent: IntentCategory;
  target: "local" | "claude";
  claudeModel?: string;
}

/**
 * Resolve the routing target for a classified intent.
 * For try_again, escalate one tier up from the previous request's tier (capped at 3).
 * Returns target and claudeModel from the tier config.
 */
export function resolveRoute(
  intent: IntentCategory,
  rules: Record<IntentCategory, RoutingRule>,
  tiers: Record<ModelTierNumber, TierModel>,
): RouteResult {
  let tier: ModelTierNumber;

  if (intent === "try_again") {
    // Escalate one tier from the last request
    const escalated = Math.min(lastRequestTier + 1, 3) as ModelTierNumber;
    tier = escalated;
  } else {
    tier = rules[intent].tier;
  }

  const { target, claudeModel } = tiers[tier];

  lastRequestTier = tier;

  return { tier, intent, target, claudeModel };
}
