/**
 * Translate OpenAI Chat Completions responses to Anthropic Messages API format.
 */

import { parseToolCalls, type ParsedToolCall } from "./parser.js";
import crypto from "node:crypto";

export interface AnthropicResponseContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, string>;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicResponseContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Convert parsed tool calls into Anthropic tool_use content blocks.
 */
function toolCallsToBlocks(toolCalls: ParsedToolCall[]): AnthropicResponseContentBlock[] {
  return toolCalls.map((tc) => ({
    type: "tool_use" as const,
    id: generateId("toolu"),
    name: tc.name,
    input: tc.input,
  }));
}

/**
 * Translate an OpenAI response (after parsing tool calls) into an Anthropic response.
 */
export function translateResponse(
  modelOutput: string,
  model: string,
): AnthropicResponse {
  const parsed = parseToolCalls(modelOutput);
  const content: AnthropicResponseContentBlock[] = [];

  if (parsed.text) {
    content.push({ type: "text", text: parsed.text });
  }

  if (parsed.toolCalls.length > 0) {
    content.push(...toolCallsToBlocks(parsed.toolCalls));
  }

  // If no content at all, add empty text block
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const stopReason = parsed.toolCalls.length > 0 ? "tool_use" : "end_turn";

  return {
    id: generateId("msg_local"),
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
