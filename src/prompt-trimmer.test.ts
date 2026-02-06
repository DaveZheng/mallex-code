import { describe, it } from "node:test";
import assert from "node:assert";
import { parseModelSize, getModelTier, trimSystemPrompt, trimMessages } from "./prompt-trimmer.js";
import type { AnthropicMessage } from "./translate-request.js";

// Realistic mock of Claude Code's system prompt (abbreviated but structurally accurate)
const MOCK_SYSTEM_PROMPT = `You are Claude Code, Anthropic's official CLI for Claude.
You are an interactive agent that helps users with software engineering tasks.

IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges.

# System
 - All text you output outside of tool use is displayed to the user.
 - Tools are executed in a user-selected permission mode.

# Doing tasks
 - The user will primarily request you to perform software engineering tasks.
 - You are highly capable and often allow users to complete ambitious tasks.
 - In general, do not propose changes to code you haven't read.
 - Do not create files unless they're absolutely necessary.

# Executing actions with care
Carefully consider the reversibility and blast radius of actions.

# Using your tools
 - Do NOT use the Bash to run commands when a relevant dedicated tool is provided.
 - To read files use Read instead of cat, head, tail, or sed
 - To edit files use Edit instead of sed or awk
 - To create files use Write instead of cat with heredoc or echo redirection
 - To search for files use Glob instead of find or ls
 - To search the content of files, use Grep instead of grep or rg

# Committing changes with git
Only create commits when requested by the user.

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard)
- CRITICAL: Always create NEW commits rather than amending

# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks.
IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:
1. Run git status and git diff
2. Analyze changes and draft PR title
3. Push and create PR with gh pr create

# Tone and style
 - Only use emojis if the user explicitly requests it.
 - Your responses should be short and concise.

# Environment
 - Primary working directory: /Users/david/Projects/myapp
   - Is a git repository: true
 - Platform: darwin
 - OS Version: Darwin 25.2.0
 - Current branch: main

# claudeMd
Contents of /Users/david/.claude/MEMORY.md (user's instructions):

# My Project
- Use typescript
- Follow existing patterns

gitStatus: This is the git status at the start of the conversation.
Current branch: main
Main branch: main
Status:
M src/index.ts

Recent commits:
abc1234 feat: add user auth`;

describe("parseModelSize", () => {
  it("extracts 7 from 7B model name", () => {
    assert.strictEqual(parseModelSize("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"), 7);
  });

  it("extracts 14 from 14B model name", () => {
    assert.strictEqual(parseModelSize("mlx-community/Qwen2.5-Coder-14B-Instruct-4bit"), 14);
  });

  it("extracts 30 from 30B model name", () => {
    assert.strictEqual(parseModelSize("mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"), 30);
  });

  it("extracts 72 from 72B model name", () => {
    assert.strictEqual(parseModelSize("some-org/Model-72B-Instruct"), 72);
  });

  it("returns null for models without explicit size", () => {
    assert.strictEqual(parseModelSize("mlx-community/Qwen3-Coder-Next-4bit"), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(parseModelSize(""), null);
  });
});

describe("getModelTier", () => {
  it("returns small for 7B", () => {
    assert.strictEqual(getModelTier("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"), "small");
  });

  it("returns small for 8B", () => {
    assert.strictEqual(getModelTier("org/Model-8B-4bit"), "small");
  });

  it("returns medium for 14B", () => {
    assert.strictEqual(getModelTier("mlx-community/Qwen2.5-Coder-14B-Instruct-4bit"), "medium");
  });

  it("returns medium for 30B", () => {
    assert.strictEqual(getModelTier("mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"), "medium");
  });

  it("returns medium for 32B", () => {
    assert.strictEqual(getModelTier("org/Model-32B-4bit"), "medium");
  });

  it("returns large for 72B", () => {
    assert.strictEqual(getModelTier("org/Model-72B-4bit"), "large");
  });

  it("defaults to large for unknown size", () => {
    assert.strictEqual(getModelTier("mlx-community/Qwen3-Coder-Next-4bit"), "large");
  });
});

describe("trimSystemPrompt", () => {
  describe("small tier (7B)", () => {
    const model = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit";

    it("strips Claude Code identity and verbose instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("You are Claude Code"), "should strip Claude Code identity");
      assert.ok(!result.includes("Anthropic's official CLI"), "should strip Anthropic branding");
    });

    it("strips git safety protocol", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Git Safety Protocol"), "should strip git protocol");
      assert.ok(!result.includes("NEVER update the git config"), "should strip git rules");
    });

    it("strips PR creation instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Creating pull requests"), "should strip PR section");
      assert.ok(!result.includes("gh pr create"), "should strip PR details");
    });

    it("strips verbose tool usage instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("To read files use Read instead of cat"), "should strip tool guidance");
    });

    it("keeps working directory", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("/Users/david/Projects/myapp"), "should keep working directory");
    });

    it("keeps git branch", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("main"), "should keep git branch");
    });

    it("keeps platform", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("darwin"), "should keep platform");
    });

    it("keeps CLAUDE.md / user instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Use typescript"), "should keep user instructions");
      assert.ok(result.includes("Follow existing patterns"), "should keep user instructions");
    });

    it("includes a basic coding assistant instruction", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("coding assistant"), "should have basic identity");
    });

    it("is significantly shorter than the original", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.length < MOCK_SYSTEM_PROMPT.length * 0.5,
        `trimmed (${result.length}) should be <50% of original (${MOCK_SYSTEM_PROMPT.length})`);
    });
  });

  describe("medium tier (14B)", () => {
    const model = "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit";

    it("strips PR creation and git protocol details", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Creating pull requests"), "should strip PR section");
      assert.ok(!result.includes("Git Safety Protocol"), "should strip git protocol");
    });

    it("keeps environment context", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("/Users/david/Projects/myapp"), "should keep working directory");
    });

    it("keeps user instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Use typescript"), "should keep user instructions");
    });

    it("includes core coding behavior instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Read files before editing") || result.includes("do not propose changes to code you haven't read"),
        "should include core coding rules");
    });
  });

  describe("large tier (72B)", () => {
    const model = "org/Model-72B-Instruct-4bit";

    it("keeps most of the original prompt", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("You are Claude Code"), "should keep identity");
      assert.ok(result.includes("Doing tasks"), "should keep task instructions");
    });

    it("keeps environment and user instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("/Users/david/Projects/myapp"), "should keep working directory");
      assert.ok(result.includes("Use typescript"), "should keep user instructions");
    });
  });

  describe("edge cases", () => {
    it("handles empty system prompt", () => {
      const result = trimSystemPrompt("", "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
      assert.ok(result.includes("coding assistant"), "should still provide minimal prompt");
    });

    it("handles system prompt with no environment section", () => {
      const prompt = "You are Claude Code. Help the user.";
      const result = trimSystemPrompt(prompt, "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
      assert.ok(result.includes("coding assistant"), "should provide minimal prompt");
    });

    it("handles system prompt with no CLAUDE.md", () => {
      const prompt = `Some instructions here.

# Environment
 - Primary working directory: /Users/test/project
 - Platform: darwin`;
      const result = trimSystemPrompt(prompt, "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
      assert.ok(result.includes("/Users/test/project"), "should keep env");
    });
  });
});

// ── trimMessages tests ──────────────────────────────────────────────

describe("trimMessages", () => {
  it("drops session start hook block", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\nSessionStart:startup hook success: Success\n</system-reminder>" },
        { type: "text", text: "Hello" },
      ],
    }];
    const result = trimMessages(messages);
    assert.strictEqual(result.length, 1);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, "Hello");
  });

  it("drops superpowers skill instructions", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        {
          type: "text",
          text: `<system-reminder>
SessionStart hook additional context: <EXTREMELY_IMPORTANT>
You have superpowers.

**Below is the full content of your 'superpowers:using-superpowers' skill**
IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
</EXTREMELY_IMPORTANT>
</system-reminder>`,
        },
        { type: "text", text: "what is 2 plus 2" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, "what is 2 plus 2");
  });

  it("drops skills listing block", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        {
          type: "text",
          text: `<system-reminder>
The following skills are available for use with the Skill tool:

- keybindings-help: Use when the user wants to customize keyboard shortcuts
- superpowers:test-driven-development: Use when implementing any feature
- superpowers:systematic-debugging: Use when encountering any bug
</system-reminder>`,
        },
        { type: "text", text: "fix the bug" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, "fix the bug");
  });

  it("drops duplicate MEMORY.md / claudeMd block", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        {
          type: "text",
          text: `<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
Contents of /Users/david/.claude/projects/memory/MEMORY.md (user's instructions):

# Memory
- Use typescript
</system-reminder>`,
        },
        { type: "text", text: "hello" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, "hello");
  });

  it("drops task tool reminders", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        {
          type: "text",
          text: `<system-reminder>
The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using TaskCreate.
</system-reminder>`,
        },
        { type: "text", text: "do the thing" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, "do the thing");
  });

  it("preserves non-text blocks (tool_use, tool_result)", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\nSessionStart:startup hook success\n</system-reminder>" },
        { type: "tool_result", tool_use_id: "call_1", content: "file contents here" },
        { type: "text", text: "now edit it" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string }[];
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, "tool_result");
    assert.strictEqual(blocks[1].type, "text");
  });

  it("does not touch assistant messages", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "<system-reminder>\nSome injected content\n</system-reminder>" },
          { type: "text", text: "I'll help you." },
        ],
      },
    ];
    const result = trimMessages(messages);
    const blocks = result[1].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 2, "should not filter assistant blocks");
  });

  it("preserves plain user text without system-reminder tags", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "what is 2 plus 2" },
    ];
    const result = trimMessages(messages);
    assert.strictEqual(result[0].content, "what is 2 plus 2");
  });

  it("returns empty content when all blocks are dropped", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\nSessionStart:startup hook success\n</system-reminder>" },
      ],
    }];
    const result = trimMessages(messages);
    assert.strictEqual(result[0].content, "");
  });

  it("unwraps unrecognized system-reminder blocks instead of dropping", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        {
          type: "text",
          text: "<system-reminder>\nSome unknown but potentially useful context\n</system-reminder>",
        },
        { type: "text", text: "help me" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 2);
    assert.ok(!blocks[0].text.includes("<system-reminder>"), "should strip tags");
    assert.ok(blocks[0].text.includes("Some unknown but potentially useful context"), "should keep inner content");
  });
});
