/**
 * Translate Anthropic Messages API requests to OpenAI Chat Completions format.
 */

import { injectToolDefinitions } from "./prompt.js";
import { trimSystemPrompt, trimMessages } from "./prompt-trimmer.js";
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
 * Flatten an Anthropic content block array into a plain text string.
 */
function flattenContent(content: string | AnthropicContentBlock[], role: "user" | "assistant"): string {
  if (typeof content === "string") return content;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "tool_use") {
      parts.push(toolUseToXml(block));
    } else if (block.type === "tool_result") {
      const resultText = typeof block.content === "string"
        ? block.content
        : block.content.map((b) => b.text).join("\n");
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
  // Build system prompt: trim for model size, then inject tool definitions
  let systemPrompt = extractSystemPrompt(req.system);
  systemPrompt = trimSystemPrompt(systemPrompt, mlxModel);
  systemPrompt = injectToolDefinitions(systemPrompt);

  // Trim infrastructure noise from user messages, then convert
  const trimmedMsgs = trimMessages(req.messages);

  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of trimmedMsgs) {
    const content = flattenContent(msg.content, msg.role);
    if (content) {
      messages.push({ role: msg.role, content });
    }
  }

  return {
    model: mlxModel,
    messages,
    max_tokens: req.max_tokens || 4096,
    temperature: 0.7,
    top_p: 0.95,
    stream: req.stream,
  };
}
