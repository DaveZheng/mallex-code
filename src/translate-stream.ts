/**
 * Translate OpenAI SSE streaming chunks to Anthropic SSE streaming events.
 *
 * Strategy: Stream text deltas in real time. When the stream ends, parse
 * accumulated text for tool calls and emit tool_use blocks.
 */

import { parseToolCalls, type ParsedToolCall } from "./parser.js";
import crypto from "node:crypto";
import type { OpenAIStreamChunk } from "./client.js";

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

/** Format an SSE event. */
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface StreamTranslator {
  /** Feed an OpenAI stream chunk. Returns SSE event strings to send. */
  push(chunk: OpenAIStreamChunk): string;
  /** Signal end of stream. Returns final SSE event strings (tool_use blocks, message_delta, message_stop). */
  finish(): string;
}

/**
 * Create a streaming translator that converts OpenAI chunks to Anthropic SSE events.
 */
export function createStreamTranslator(model: string): StreamTranslator {
  const messageId = generateId("msg_local");
  let accumulated = "";
  let textBlockStarted = false;
  let blockIndex = 0;
  let headerSent = false;

  function ensureHeader(): string {
    if (headerSent) return "";
    headerSent = true;
    return sseEvent("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function ensureTextBlock(): string {
    if (textBlockStarted) return "";
    textBlockStarted = true;
    return sseEvent("content_block_start", {
      type: "content_block_start",
      index: blockIndex,
      content_block: { type: "text", text: "" },
    });
  }

  return {
    push(chunk: OpenAIStreamChunk): string {
      const raw = chunk.choices?.[0]?.delta?.content;
      if (!raw) return ensureHeader();

      // Strip special tokens that leak from Qwen/Llama models
      const delta = raw.replace(/<\|im_end\|>/g, "").replace(/<\|im_start\|>/g, "");
      if (!delta) return ensureHeader();

      accumulated += delta;

      let output = ensureHeader();
      output += ensureTextBlock();
      output += sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "text_delta", text: delta },
      });
      return output;
    },

    finish(): string {
      let output = ensureHeader();
      const parsed = parseToolCalls(accumulated);

      // Close text block if we opened one
      if (textBlockStarted) {
        output += sseEvent("content_block_stop", {
          type: "content_block_stop",
          index: blockIndex,
        });
        blockIndex++;
      }

      // If the parsed text differs from accumulated (tool calls were stripped),
      // and we already streamed the raw text including XML tags, that's OK —
      // Claude Code will see the tool_use blocks and use those.

      // Emit tool_use blocks
      if (parsed.toolCalls.length > 0) {
        for (const tc of parsed.toolCalls) {
          const toolId = generateId("toolu");
          output += sseEvent("content_block_start", {
            type: "content_block_start",
            index: blockIndex,
            content_block: { type: "tool_use", id: toolId, name: tc.name, input: {} },
          });
          output += sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(tc.input) },
          });
          output += sseEvent("content_block_stop", {
            type: "content_block_stop",
            index: blockIndex,
          });
          blockIndex++;
        }
      }

      const stopReason = parsed.toolCalls.length > 0 ? "tool_use" : "end_turn";

      output += sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason },
        usage: { output_tokens: 0 },
      });
      output += sseEvent("message_stop", { type: "message_stop" });

      return output;
    },
  };
}
