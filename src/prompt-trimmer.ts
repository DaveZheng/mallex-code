/**
 * Trim Claude Code's system prompt based on the local model's size.
 *
 * Instead of replacing the prompt wholesale, we surgically strip sections
 * that reference Claude Code infrastructure the local model can't use,
 * while preserving the core behavioral instructions that make it a good
 * coding assistant.
 *
 * Trimming tiers (by section priority):
 *
 *   Always strip (all tiers):
 *     - "# Using your tools" — references Claude Code tools (Read/Edit/Glob/etc.)
 *     - "# auto memory" — local model can't write to memory files
 *     - "# MCP Server Instructions" — local model has no MCP
 *     - "# System" — Claude Code infrastructure (permissions, hooks, etc.)
 *     - Claude-specific identity line
 *     - Anthropic-specific security rules
 *     - Model/knowledge cutoff info in Environment
 *
 *   Strip for small (≤8B) only:
 *     - "# Executing actions with care" — verbose examples, condensed into Doing tasks
 *     - Git commit/PR workflow instructions
 *
 *   Always keep:
 *     - "# Doing tasks" — core coding behavior (read before edit, don't over-engineer, etc.)
 *     - "# Tone and style" — concise, no emojis
 *     - Environment (working dir, platform, git branch)
 *     - User instructions (CLAUDE.md / MEMORY.md content)
 *     - Git status snapshot
 */

import type { AnthropicMessage, AnthropicContentBlock, AnthropicTextBlock } from "./translate-request.js";

export type ModelTier = "small" | "medium" | "large";

/**
 * Extract the parameter count (in billions) from a model ID.
 * Returns null if no size indicator is found.
 *
 * Examples:
 *   "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit" → 7
 *   "mlx-community/Qwen3-Coder-Next-4bit"           → null
 */
export function parseModelSize(modelId: string): number | null {
  const match = modelId.match(/(\d+)[Bb](?:-|$)/);
  return match ? parseInt(match[1], 10) : null;
}

export function getModelTier(modelId: string): ModelTier {
  const size = parseModelSize(modelId);
  if (size === null) return "large";
  if (size <= 8) return "small";
  if (size <= 32) return "medium";
  return "large";
}

// ── Section stripping ──────────────────────────────────────────────

/**
 * Remove a markdown section by heading (e.g., "# Using your tools").
 * Removes everything from the heading to the next same-level heading or end.
 */
function stripSection(prompt: string, heading: string): string {
  // Determine heading level
  const level = heading.match(/^(#+)/)?.[1].length ?? 1;
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match from heading to next same-or-higher-level heading or end
  const pattern = new RegExp(
    `\\n?${escapedHeading}\\n[\\s\\S]*?(?=\\n#{1,${level}} [^#]|$)`,
  );
  return prompt.replace(pattern, "");
}

/**
 * Remove a specific text block from the prompt.
 */
function stripText(prompt: string, text: string): string {
  return prompt.replace(text, "");
}

/**
 * Remove lines matching a pattern.
 */
function stripLines(prompt: string, pattern: RegExp): string {
  return prompt.split("\n").filter((line) => !pattern.test(line)).join("\n");
}

/**
 * Collapse 3+ consecutive newlines to 2.
 */
function collapseNewlines(prompt: string): string {
  return prompt.replace(/\n{3,}/g, "\n\n");
}

// ── Extraction helpers ──────────────────────────────────────────────

/**
 * Extract user-specific instructions (CLAUDE.md / MEMORY.md content).
 * Looks for "Contents of ...:" blocks and grabs their content.
 */
function extractUserInstructions(prompt: string): string {
  const match = prompt.match(
    /Contents of [^\n]+:\s*\n([\s\S]*?)(?=\n(?:gitStatus:|IMPORTANT:|<system-reminder>)|$)/,
  );
  return match ? match[1].trim() : "";
}

// ── Main entry point ────────────────────────────────────────────────

export function trimSystemPrompt(systemPrompt: string, modelId: string): string {
  const tier = getModelTier(modelId);

  if (tier === "large") {
    return systemPrompt;
  }

  let prompt = systemPrompt;

  // ── Always strip (all non-large tiers) ──────────────────────────

  // Claude-specific identity
  prompt = stripText(prompt, "You are Claude Code, Anthropic's official CLI for Claude.\n");

  // Anthropic-specific security block
  prompt = prompt.replace(
    /IMPORTANT: Assist with authorized security testing[\s\S]*?(?=IMPORTANT: You must NEVER|# System|\n\n)/,
    "",
  );
  prompt = prompt.replace(
    /IMPORTANT: You must NEVER generate or guess URLs[^\n]*\n[^\n]*\n/,
    "",
  );

  // "# System" — Claude Code infrastructure (permissions, hooks, compression, etc.)
  prompt = stripSection(prompt, "# System");

  // "# Using your tools" — references Claude Code's tools, not ours
  prompt = stripSection(prompt, "# Using your tools");

  // "# auto memory" — local model can't write to memory files
  // But preserve user instructions (MEMORY.md content) first
  const userInstructions = extractUserInstructions(prompt);
  prompt = stripSection(prompt, "# auto memory");

  // "# MCP Server Instructions"
  prompt = stripSection(prompt, "# MCP Server Instructions");

  // Model/knowledge cutoff info in Environment — not relevant
  prompt = stripLines(prompt, /You are powered by the model/);
  prompt = stripLines(prompt, /Assistant knowledge cutoff/);
  prompt = stripLines(prompt, /The most recent Claude model family/);
  prompt = stripLines(prompt, /The current date is/);

  // Feedback/help links — not applicable
  prompt = prompt.replace(
    / - If the user asks for help[\s\S]*?\/issues\n/,
    "",
  );

  // ── Strip for small tier only ───────────────────────────────────

  if (tier === "small") {
    // "# Executing actions with care" — too verbose for small models
    prompt = stripSection(prompt, "# Executing actions with care");

    // Git commit/PR sections within "# Doing tasks" if present
    prompt = prompt.replace(
      /# Committing changes with git[\s\S]*?(?=# Creating pull requests|# Other common|# Tone|$)/,
      "",
    );
    prompt = prompt.replace(
      /# Creating pull requests[\s\S]*?(?=# Other common|# Tone|$)/,
      "",
    );
    prompt = prompt.replace(
      /# Other common operations[\s\S]*?(?=# Tone|$)/,
      "",
    );
  }

  // ── Add general-knowledge rule and re-inject user instructions ──

  // Add rule about answering general questions directly
  const generalRule = "\n- For general knowledge questions, answer directly without using tools.";
  const doingTasksIdx = prompt.indexOf("# Doing tasks");
  if (doingTasksIdx !== -1) {
    // Insert after the first line of "# Doing tasks" section
    const nextNewline = prompt.indexOf("\n", doingTasksIdx);
    if (nextNewline !== -1) {
      prompt = prompt.slice(0, nextNewline + 1) + generalRule + prompt.slice(nextNewline + 1);
    }
  }

  // Re-inject user instructions if we had them
  if (userInstructions) {
    prompt += `\n\n## Project Instructions\n${userInstructions}`;
  }

  return collapseNewlines(prompt).trim();
}

// ── Message trimming ─────────────────────────────────────────────────

/**
 * Test whether a text block is a <system-reminder> wrapper.
 */
function isSystemReminder(text: string): boolean {
  return /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/.test(text);
}

/**
 * Strip <system-reminder> wrappers from a text block, returning the inner content.
 */
function stripSystemReminderTags(text: string): string {
  return text.replace(/<\/?system-reminder>/g, "").trim();
}

/**
 * Test whether text is purely Claude Code infrastructure with no user value.
 * These are blocks that should be dropped entirely (not just unwrapped).
 */
function isDroppableBlock(text: string): boolean {
  const inner = stripSystemReminderTags(text);

  // Session start hook confirmations
  if (/^SessionStart[:.]/.test(inner)) return true;

  // Superpowers / skill system meta-instructions
  if (inner.includes("EXTREMELY_IMPORTANT") && inner.includes("superpowers")) return true;
  if (inner.includes("You have superpowers")) return true;

  // Skills listing
  if (/^The following skills are available/.test(inner)) return true;

  // Task tool reminders
  if (/^The task tools haven't been used recently/.test(inner)) return true;

  // Malware analysis reminders
  if (/^Whenever you read a file.*malware/.test(inner)) return true;

  return false;
}

/**
 * Test whether a text block is a duplicate of content already in the system prompt.
 * Matches the "claudeMd" / MEMORY.md block that Claude Code sends in both
 * the system field and as a user message content block.
 */
function isDuplicateClaudeMd(text: string): boolean {
  const inner = stripSystemReminderTags(text);
  return inner.includes("# claudeMd") || inner.includes("Contents of ") && inner.includes("MEMORY.md");
}

/**
 * Trim user message content blocks, removing Claude Code infrastructure
 * that wastes context on local models.
 *
 * Applied to all tiers — even large models benefit from not processing
 * 8K+ chars of skills/superpowers infrastructure they can't use.
 */
export function trimMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  return messages.map((msg) => {
    // Only trim user messages — assistant messages are model history
    if (msg.role !== "user") return msg;

    // String content: strip system-reminder tags inline
    if (typeof msg.content === "string") {
      if (isSystemReminder(msg.content) && isDroppableBlock(msg.content)) {
        return { role: msg.role, content: "" };
      }
      return msg;
    }

    // Array content: filter out droppable text blocks
    const filtered: AnthropicContentBlock[] = [];
    for (const block of msg.content) {
      if (block.type !== "text") {
        filtered.push(block);
        continue;
      }

      // Drop entire block if it's infrastructure noise
      if (isSystemReminder(block.text) && isDroppableBlock(block.text)) {
        continue;
      }

      // Drop duplicate CLAUDE.md / MEMORY.md (already in system prompt)
      if (isSystemReminder(block.text) && isDuplicateClaudeMd(block.text)) {
        continue;
      }

      // For remaining system-reminder blocks, unwrap the tags
      // (keeps content like tool results that happen to be wrapped)
      if (isSystemReminder(block.text)) {
        const unwrapped = stripSystemReminderTags(block.text);
        if (unwrapped) {
          filtered.push({ type: "text", text: unwrapped } as AnthropicTextBlock);
        }
        continue;
      }

      filtered.push(block);
    }

    // If all blocks were filtered, keep a single empty text block
    // so the message structure remains valid
    if (filtered.length === 0) {
      return { role: msg.role, content: "" };
    }

    return { role: msg.role, content: filtered };
  });
}
