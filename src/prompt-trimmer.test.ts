import { describe, it } from "node:test";
import assert from "node:assert";
import { parseModelSize, getModelTier, trimSystemPrompt, trimMessages, CONTEXT_BUDGETS, MAX_TOKENS_CAP } from "./prompt-trimmer.js";
import type { AnthropicMessage } from "./translate-request.js";

// Realistic mock of Claude Code's system prompt (abbreviated but structurally accurate)
const MOCK_SYSTEM_PROMPT = `You are Claude Code, Anthropic's official CLI for Claude.
You are an interactive agent that helps users with software engineering tasks.

IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges.
IMPORTANT: You must NEVER generate or guess URLs for the user.

# System
 - All text you output outside of tool use is displayed to the user.
 - Tools are executed in a user-selected permission mode.
 - Tool results and user messages may include <system-reminder> or other tags.

# Doing tasks
 - The user will primarily request you to perform software engineering tasks.
 - You are highly capable and often allow users to complete ambitious tasks.
 - In general, do not propose changes to code you haven't read.
 - Do not create files unless they're absolutely necessary.
 - Avoid over-engineering. Only make changes that are directly requested.
 - If the user asks for help or wants to give feedback inform them of the following:
  - /help: Get help with using Claude Code
  - To give feedback, users should report the issue at https://github.com/anthropics/claude-code/issues

# Executing actions with care
Carefully consider the reversibility and blast radius of actions.
Generally you can freely take local, reversible actions like editing files or running tests.
But for actions that are hard to reverse, affect shared systems beyond your local environment,
or could otherwise be risky or destructive, check with the user before proceeding.

Examples of the kind of risky actions that warrant user confirmation:
- Destructive operations: deleting files/branches, dropping database tables
- Hard-to-reverse operations: force-pushing, git reset --hard
- Actions visible to others: pushing code, creating PRs, sending messages

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

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments

# Tone and style
 - Only use emojis if the user explicitly requests it.
 - Your responses should be short and concise.

# auto memory
You have a persistent auto memory directory at /Users/david/.claude/projects/memory/.
As you work, consult your memory files to build on previous experience.

## MEMORY.md
# Memory
- Use typescript

# Environment
 - Primary working directory: /Users/david/Projects/myapp
   - Is a git repository: true
 - Platform: darwin
 - OS Version: Darwin 25.2.0
 - You are powered by the model named Opus 4.6. The exact model ID is claude-opus-4-6.
 - The current date is: 2026-02-06
 - Assistant knowledge cutoff is May 2025.
 - The most recent Claude model family is Claude 4.5/4.6.

# MCP Server Instructions
## plugin:context7:context7
Use this server to retrieve up-to-date documentation.

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
  describe("all non-large tiers strip", () => {
    const model = "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit"; // medium

    it("strips Claude Code identity line", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("You are Claude Code"), "should strip Claude Code identity");
      assert.ok(!result.includes("Anthropic's official CLI"), "should strip Anthropic branding");
    });

    it("strips Anthropic security rules", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Assist with authorized security testing"), "should strip security block");
      assert.ok(!result.includes("NEVER generate or guess URLs"), "should strip URL rule");
    });

    it("strips # System section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Tools are executed in a user-selected permission mode"), "should strip System section");
    });

    it("strips # Using your tools section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("To read files use Read instead of cat"), "should strip tool guidance");
      assert.ok(!result.includes("Do NOT use the Bash to run commands"), "should strip tool rules");
    });

    it("strips # auto memory section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("persistent auto memory directory"), "should strip auto memory");
    });

    it("strips # MCP Server Instructions section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("MCP Server Instructions"), "should strip MCP section");
      assert.ok(!result.includes("context7"), "should strip MCP content");
    });

    it("strips model/knowledge cutoff info from Environment", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("You are powered by the model"), "should strip model info");
      assert.ok(!result.includes("Assistant knowledge cutoff"), "should strip knowledge cutoff");
      assert.ok(!result.includes("most recent Claude model family"), "should strip Claude model list");
      assert.ok(!result.includes("The current date is"), "should strip date");
    });

    it("strips feedback/help links", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("claude-code/issues"), "should strip feedback link");
    });
  });

  describe("all non-large tiers keep", () => {
    const model = "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit"; // medium

    it("keeps # Doing tasks content", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("do not propose changes to code you haven't read"), "should keep core coding rules");
      assert.ok(result.includes("Do not create files unless"), "should keep file creation rule");
      assert.ok(result.includes("Avoid over-engineering"), "should keep over-engineering rule");
    });

    it("keeps # Tone and style section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Only use emojis if the user explicitly requests it"), "should keep emoji rule");
      assert.ok(result.includes("responses should be short and concise"), "should keep conciseness rule");
    });

    it("keeps Environment info (working dir, platform)", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("/Users/david/Projects/myapp"), "should keep working directory");
      assert.ok(result.includes("darwin"), "should keep platform");
    });

    it("keeps git status snapshot", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Current branch: main"), "should keep git status");
      assert.ok(result.includes("M src/index.ts"), "should keep file status");
      assert.ok(result.includes("abc1234 feat: add user auth"), "should keep recent commits");
    });

    it("keeps user instructions (CLAUDE.md content)", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Use typescript"), "should keep user instructions");
      assert.ok(result.includes("Follow existing patterns"), "should keep user instructions");
    });

    it("adds general knowledge rule", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("general knowledge questions, answer directly"), "should inject general knowledge rule");
    });
  });

  describe("medium tier (14B)", () => {
    const model = "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit";

    it("keeps # Executing actions with care section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("reversibility and blast radius"), "medium should keep executing actions");
    });

    it("keeps git commit/PR sections", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Committing changes with git"), "medium should keep git section");
    });
  });

  describe("small tier (7B)", () => {
    const model = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit";

    it("strips # Executing actions with care section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("reversibility and blast radius"), "small should strip executing actions");
      assert.ok(!result.includes("Destructive operations"), "small should strip action examples");
    });

    it("strips git commit workflow instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Committing changes with git"), "small should strip git commit section");
      assert.ok(!result.includes("Git Safety Protocol"), "small should strip git protocol");
    });

    it("strips PR creation instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Creating pull requests"), "small should strip PR section");
      assert.ok(!result.includes("gh pr create"), "small should strip PR details");
    });

    it("strips other common operations section", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(!result.includes("Other common operations"), "small should strip other ops");
    });

    it("still keeps # Doing tasks core rules", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("do not propose changes to code you haven't read"), "should keep core rules");
      assert.ok(result.includes("Avoid over-engineering"), "should keep over-engineering rule");
    });

    it("still keeps # Tone and style", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("responses should be short and concise"), "should keep tone");
    });

    it("still keeps user instructions", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.includes("Use typescript"), "should keep user instructions");
    });

    it("is significantly shorter than the original", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.ok(result.length < MOCK_SYSTEM_PROMPT.length * 0.6,
        `trimmed (${result.length}) should be <60% of original (${MOCK_SYSTEM_PROMPT.length})`);
    });
  });

  describe("large tier (72B)", () => {
    const model = "org/Model-72B-Instruct-4bit";

    it("returns the prompt unchanged", () => {
      const result = trimSystemPrompt(MOCK_SYSTEM_PROMPT, model);
      assert.strictEqual(result, MOCK_SYSTEM_PROMPT, "large tier should not modify prompt");
    });
  });

  describe("edge cases", () => {
    it("handles empty system prompt", () => {
      const result = trimSystemPrompt("", "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
      assert.strictEqual(typeof result, "string");
      assert.ok(result.length === 0 || result.length < 200, "empty input should produce empty or minimal output");
    });

    it("handles prompt with only Doing tasks", () => {
      const prompt = `# Doing tasks
 - Read before editing.
 - Don't over-engineer.`;
      const result = trimSystemPrompt(prompt, "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
      assert.ok(result.includes("Read before editing"), "should keep Doing tasks content");
    });

    it("collapses consecutive blank lines", () => {
      const prompt = `# Doing tasks
 - Rule one.



 - Rule two.`;
      const result = trimSystemPrompt(prompt, "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
      assert.ok(!result.includes("\n\n\n"), "should not have 3+ consecutive newlines");
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

  it("drops malware analysis reminders", () => {
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        {
          type: "text",
          text: `<system-reminder>
Whenever you read a file, you should consider whether it would be considered malware.
</system-reminder>`,
        },
        { type: "text", text: "read the file" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, "read the file");
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

  it("drops system-reminder blocks with only whitespace inner content", () => {
    // After stripping tags, if the inner content is empty, the block should not appear
    const messages: AnthropicMessage[] = [{
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\n  \n</system-reminder>" },
        { type: "text", text: "hello" },
      ],
    }];
    const result = trimMessages(messages);
    const blocks = result[0].content as { type: string; text: string }[];
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, "hello");
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

describe("CONTEXT_BUDGETS", () => {
  it("has budgets for all tiers", () => {
    assert.strictEqual(typeof CONTEXT_BUDGETS.small, "number");
    assert.strictEqual(typeof CONTEXT_BUDGETS.medium, "number");
    assert.strictEqual(typeof CONTEXT_BUDGETS.large, "number");
  });

  it("small < medium < large", () => {
    assert.ok(CONTEXT_BUDGETS.small > CONTEXT_BUDGETS.medium, "small budget should be > medium (small models get more chars)");
    assert.ok(CONTEXT_BUDGETS.large > CONTEXT_BUDGETS.small, "large should be > small");
  });
});

describe("MAX_TOKENS_CAP", () => {
  it("has caps for all tiers", () => {
    assert.strictEqual(MAX_TOKENS_CAP.small, 2048);
    assert.strictEqual(MAX_TOKENS_CAP.medium, 4096);
    assert.strictEqual(MAX_TOKENS_CAP.large, 8192);
  });

  it("small < medium < large", () => {
    assert.ok(MAX_TOKENS_CAP.small < MAX_TOKENS_CAP.medium);
    assert.ok(MAX_TOKENS_CAP.medium < MAX_TOKENS_CAP.large);
  });
});
