/**
 * Translate Anthropic Messages API requests to OpenAI Chat Completions format.
 */

import { injectToolDefinitions } from "./prompt.js";
import { trimSystemPrompt, trimMessages, getModelTier, CONTEXT_BUDGETS, MAX_TOKENS_CAP } from "./prompt-trimmer.js";
import type { OpenAIChatRequest } from "./client.js";

/** Anthropic content block types */
export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicTextBlock[];
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string | { type: "text"; text: string }[];
  messages: AnthropicMessage[];
  tools?: AnthropicToolDef[];
  stream?: boolean;
}

/**
 * Format a tool_use block back to XML so the model sees consistent history.
 */
function toolUseToXml(block: AnthropicToolUseBlock): string {
  const params = Object.entries(block.input)
    .map(([k, v]) => `<parameter=${k}>${String(v)}</parameter>`)
    .join("\n");
  return `<tool_call>\n<function=${block.name}>\n${params}\n</function>\n</tool_call>`;
}

/**
 * Truncate a tool result string to fit within a character budget.
 * Adds metadata header so the model knows content was truncated.
 */
export function truncateToolResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  return `(truncated: showing ${maxChars.toLocaleString()} of ${text.length.toLocaleString()} chars)\n${truncated}\n...(${(text.length - maxChars).toLocaleString()} chars omitted)`;
}

/**
 * Flatten an Anthropic content block array into a plain text string.
 * When toolResultBudget is set, tool result blocks exceeding it are truncated.
 */
function flattenContent(content: string | AnthropicContentBlock[], role: "user" | "assistant", toolResultBudget?: number): string {
  if (typeof content === "string") return content;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "tool_use") {
      parts.push(toolUseToXml(block));
    } else if (block.type === "tool_result") {
      let resultText = typeof block.content === "string"
        ? block.content
        : block.content.map((b) => b.text).join("\n");
      if (toolResultBudget !== undefined) {
        resultText = truncateToolResult(resultText, toolResultBudget);
      }
      parts.push(`Tool result for ${block.tool_use_id}:\n${resultText}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * Extract the system prompt string from Anthropic's system field.
 */
function extractSystemPrompt(system: AnthropicRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

/**
 * Translate an Anthropic Messages API request to an OpenAI Chat Completions request.
 */
export function translateRequest(req: AnthropicRequest, mlxModel: string): OpenAIChatRequest {
  const tier = getModelTier(mlxModel);

  // Build system prompt: trim for model size, then inject tool definitions
  let systemPrompt = extractSystemPrompt(req.system);
  systemPrompt = trimSystemPrompt(systemPrompt, mlxModel);
  systemPrompt = injectToolDefinitions(systemPrompt);

  // Calculate per-tool-result budget: 40% of remaining context after system prompt
  const budget = CONTEXT_BUDGETS[tier];
  const remaining = Math.max(0, budget - systemPrompt.length);
  const toolResultBudget = Math.floor(remaining * 0.4);

  // Trim infrastructure noise from user messages, then convert
  const trimmedMsgs = trimMessages(req.messages);

  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of trimmedMsgs) {
    const content = flattenContent(msg.content, msg.role, toolResultBudget);
    if (content) {
      messages.push({ role: msg.role, content });
    }
  }

  // Cap max_tokens based on model tier
  const maxTokens = Math.min(req.max_tokens || 4096, MAX_TOKENS_CAP[tier]);

  return {
    model: mlxModel,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.95,
    stream: req.stream,
    stop: ["</tool_call>"],
  };
}
