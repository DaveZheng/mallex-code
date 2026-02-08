import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  extractLatestUserText,
  parseCategory,
  classifyIntent,
  resolveRoute,
  resetLastRequestTier,
} from "./router.js";
import type { AnthropicMessage } from "./translate-request.js";
import type { OpenAIChatRequest, OpenAIChatResponse } from "./client.js";
import type { IntentCategory, ModelTierNumber, RoutingRule, TierModel } from "./config.js";
import { DEFAULT_ROUTING_RULES } from "./config.js";

// ── extractLatestUserText ────────────────────────────────────────────

describe("extractLatestUserText", () => {
  it("returns string content from the last user message", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "sure" },
      { role: "user", content: "second question" },
    ];
    assert.strictEqual(extractLatestUserText(messages), "second question");
  });

  it("extracts text blocks from array content", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
    ];
    assert.strictEqual(extractLatestUserText(messages), "hello\nworld");
  });

  it("skips tool_result blocks in array content", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: "file contents" },
          { type: "text", text: "now edit it" },
        ],
      },
    ];
    assert.strictEqual(extractLatestUserText(messages), "now edit it");
  });

  it("returns empty string for empty messages array", () => {
    assert.strictEqual(extractLatestUserText([]), "");
  });

  it("returns empty string when no user messages exist", () => {
    const messages: AnthropicMessage[] = [
      { role: "assistant", content: "I can help." },
    ];
    assert.strictEqual(extractLatestUserText(messages), "");
  });

  it("truncates to 500 characters", () => {
    const longText = "a".repeat(1000);
    const messages: AnthropicMessage[] = [
      { role: "user", content: longText },
    ];
    const result = extractLatestUserText(messages);
    assert.strictEqual(result.length, 500);
  });

  it("truncates array content to 500 characters", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "x".repeat(600) },
        ],
      },
    ];
    const result = extractLatestUserText(messages);
    assert.strictEqual(result.length, 500);
  });

  it("skips user messages with only tool_result blocks", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "actual question" },
      {
        role: "assistant",
        content: "let me check",
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: "some output" },
        ],
      },
    ];
    // The last user message has only tool_result, so walk back to the previous user message
    assert.strictEqual(extractLatestUserText(messages), "actual question");
  });
});

// ── parseCategory ────────────────────────────────────────────────────

describe("parseCategory", () => {
  it("returns chit_chat for exact match", () => {
    assert.strictEqual(parseCategory("chit_chat"), "chit_chat");
  });

  it("returns simple_code for exact match", () => {
    assert.strictEqual(parseCategory("simple_code"), "simple_code");
  });

  it("returns hard_question for exact match", () => {
    assert.strictEqual(parseCategory("hard_question"), "hard_question");
  });

  it("returns try_again for exact match", () => {
    assert.strictEqual(parseCategory("try_again"), "try_again");
  });

  it("handles leading/trailing whitespace", () => {
    assert.strictEqual(parseCategory("  chit_chat  \n"), "chit_chat");
  });

  it("handles uppercase", () => {
    assert.strictEqual(parseCategory("HARD_QUESTION"), "hard_question");
  });

  it("fuzzy matches 'chit' to chit_chat", () => {
    assert.strictEqual(parseCategory("chit"), "chit_chat");
  });

  it("fuzzy matches 'simple' to simple_code", () => {
    assert.strictEqual(parseCategory("simple"), "simple_code");
  });

  it("fuzzy matches 'hard' to hard_question", () => {
    assert.strictEqual(parseCategory("hard"), "hard_question");
  });

  it("fuzzy matches 'complex' to hard_question", () => {
    assert.strictEqual(parseCategory("complex"), "hard_question");
  });

  it("fuzzy matches 'try' to try_again", () => {
    assert.strictEqual(parseCategory("try"), "try_again");
  });

  it("defaults to simple_code for unknown input", () => {
    assert.strictEqual(parseCategory("banana"), "simple_code");
  });

  it("defaults to simple_code for empty string", () => {
    assert.strictEqual(parseCategory(""), "simple_code");
  });
});

// ── classifyIntent ───────────────────────────────────────────────────

describe("classifyIntent", () => {
  function mockChatCompletion(returnContent: string) {
    return async (body: OpenAIChatRequest, _port: number): Promise<OpenAIChatResponse> => {
      return {
        id: "mock-id",
        choices: [
          {
            message: { role: "assistant", content: returnContent },
            finish_reason: "stop",
            index: 0,
          },
        ],
      };
    };
  }

  it("returns the classified category from model response", async () => {
    const deps = { chatCompletion: mockChatCompletion("hard_question") };
    const result = await classifyIntent("refactor all modules", "test-model", 8080, deps);
    assert.strictEqual(result, "hard_question");
  });

  it("sends the correct prompt structure", async () => {
    const captured: OpenAIChatRequest[] = [];
    const deps = {
      chatCompletion: async (body: OpenAIChatRequest, _port: number): Promise<OpenAIChatResponse> => {
        captured.push(body);
        return {
          id: "mock-id",
          choices: [{ message: { role: "assistant", content: "simple_code" }, finish_reason: "stop", index: 0 }],
        };
      },
    };

    await classifyIntent("fix the typo", "my-model", 9090, deps);

    assert.strictEqual(captured.length, 1, "should have captured the request body");
    const body = captured[0];
    assert.strictEqual(body.model, "my-model");
    assert.strictEqual(body.max_tokens, 20);
    assert.strictEqual(body.temperature, 0.0);
    assert.strictEqual(body.top_p, 1.0);
    assert.strictEqual(body.stream, false);
    assert.strictEqual(body.messages.length, 1);
    assert.ok(body.messages[0].content.includes("Classify this user message"));
    assert.ok(body.messages[0].content.includes("fix the typo"));
  });

  it("defaults to simple_code on error", async () => {
    const deps = {
      chatCompletion: async (_body: OpenAIChatRequest, _port: number): Promise<OpenAIChatResponse> => {
        throw new Error("connection refused");
      },
    };
    const result = await classifyIntent("anything", "model", 8080, deps);
    assert.strictEqual(result, "simple_code");
  });

  it("handles fuzzy model output", async () => {
    const deps = { chatCompletion: mockChatCompletion("chit") };
    const result = await classifyIntent("how are you?", "model", 8080, deps);
    assert.strictEqual(result, "chit_chat");
  });
});

// ── resolveRoute ─────────────────────────────────────────────────────

describe("resolveRoute", () => {
  const rules = DEFAULT_ROUTING_RULES;

  const defaultTiers: Record<ModelTierNumber, TierModel> = {
    1: { target: "local" },
    2: { target: "claude", claudeModel: "claude-sonnet-4-5-20250929" },
    3: { target: "claude", claudeModel: "claude-opus-4-6" },
  };

  beforeEach(() => {
    resetLastRequestTier();
  });

  it("routes chit_chat to the configured tier", () => {
    const result = resolveRoute("chit_chat", rules, defaultTiers);
    assert.strictEqual(result.tier, 1);
    assert.strictEqual(result.intent, "chit_chat");
    assert.strictEqual(result.target, "local");
  });

  it("routes simple_code to the configured tier", () => {
    const result = resolveRoute("simple_code", rules, defaultTiers);
    assert.strictEqual(result.tier, 1);
    assert.strictEqual(result.intent, "simple_code");
    assert.strictEqual(result.target, "local");
  });

  it("routes hard_question to tier 3 (claude)", () => {
    const result = resolveRoute("hard_question", rules, defaultTiers);
    assert.strictEqual(result.tier, 3);
    assert.strictEqual(result.intent, "hard_question");
    assert.strictEqual(result.target, "claude");
  });

  it("try_again escalates from tier 1 to tier 2", () => {
    // First request sets lastRequestTier to 1 (default)
    const result = resolveRoute("try_again", rules, defaultTiers);
    assert.strictEqual(result.tier, 2);
    assert.strictEqual(result.intent, "try_again");
    assert.strictEqual(result.target, "claude");
  });

  it("try_again escalates from tier 2 to tier 3", () => {
    // Set lastRequestTier to 2 by making a request first
    const customRules: Record<IntentCategory, RoutingRule> = {
      ...rules,
      simple_code: { tier: 2 },
    };
    resolveRoute("simple_code", customRules, defaultTiers); // sets lastRequestTier = 2
    const result = resolveRoute("try_again", customRules, defaultTiers);
    assert.strictEqual(result.tier, 3);
    assert.strictEqual(result.target, "claude");
  });

  it("try_again caps at tier 3", () => {
    // Set lastRequestTier to 3 first
    resolveRoute("hard_question", rules, defaultTiers); // sets lastRequestTier = 3
    const result = resolveRoute("try_again", rules, defaultTiers);
    assert.strictEqual(result.tier, 3);
    assert.strictEqual(result.target, "claude");
  });

  it("target is local for tier 1", () => {
    const result = resolveRoute("chit_chat", rules, defaultTiers);
    assert.strictEqual(result.target, "local");
  });

  it("target is local for tier 2 when tier config says local", () => {
    const localTiers: Record<ModelTierNumber, TierModel> = {
      ...defaultTiers,
      2: { target: "local" },
    };
    const customRules: Record<IntentCategory, RoutingRule> = {
      ...rules,
      simple_code: { tier: 2 },
    };
    const result = resolveRoute("simple_code", customRules, localTiers);
    assert.strictEqual(result.target, "local");
  });

  it("target is claude for tier 3", () => {
    const result = resolveRoute("hard_question", rules, defaultTiers);
    assert.strictEqual(result.target, "claude");
  });

  it("updates lastRequestTier after resolving", () => {
    resolveRoute("hard_question", rules, defaultTiers); // tier 3
    // Now try_again should escalate from 3, capped at 3
    const result = resolveRoute("try_again", rules, defaultTiers);
    assert.strictEqual(result.tier, 3);
  });

  it("returns claudeModel from tier config", () => {
    const result = resolveRoute("hard_question", rules, defaultTiers);
    assert.strictEqual(result.tier, 3);
    assert.strictEqual(result.claudeModel, "claude-opus-4-6");
  });

  it("returns undefined claudeModel for local tier", () => {
    const result = resolveRoute("chit_chat", rules, defaultTiers);
    assert.strictEqual(result.tier, 1);
    assert.strictEqual(result.claudeModel, undefined);
  });

  it("powerful local tier: try_again escalation stays local when tier 2 is local", () => {
    const localTiers: Record<ModelTierNumber, TierModel> = {
      1: { target: "local" },
      2: { target: "local" },
      3: { target: "claude", claudeModel: "claude-opus-4-6" },
    };
    // Default lastRequestTier is 1, try_again escalates to tier 2
    const result = resolveRoute("try_again", rules, localTiers);
    assert.strictEqual(result.tier, 2);
    assert.strictEqual(result.target, "local");
    assert.strictEqual(result.claudeModel, undefined);
  });
});
