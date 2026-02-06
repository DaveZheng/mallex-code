export interface ParsedToolCall {
  name: string;
  input: Record<string, string>;
}

export interface ParseResult {
  text: string;
  toolCalls: ParsedToolCall[];
}

/**
 * Map local tool names to Claude Code tool names.
 * The local model calls tools by the names in our injected definitions,
 * but Claude Code expects its own tool names.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
};

/**
 * Map local parameter names to Claude Code parameter names where they differ.
 */
const PARAM_NAME_MAP: Record<string, Record<string, string>> = {
  Read: { file_path: "file_path", offset: "offset", limit: "limit" },
  Write: { file_path: "file_path", content: "content" },
  Edit: { file_path: "file_path", old_string: "old_string", new_string: "new_string" },
  Bash: { command: "command" },
  Glob: { pattern: "pattern", path: "path" },
  Grep: { pattern: "pattern", path: "path" },
};

function mapToolCall(name: string, input: Record<string, string>): ParsedToolCall {
  const mappedName = TOOL_NAME_MAP[name] ?? name;
  const paramMap = PARAM_NAME_MAP[mappedName];
  if (!paramMap) return { name: mappedName, input };

  const mappedInput: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    mappedInput[paramMap[key] ?? key] = value;
  }
  return { name: mappedName, input: mappedInput };
}

export function parseToolCalls(output: string): ParseResult {
  const toolCalls: ParsedToolCall[] = [];

  // Strip special tokens that leak from tokenizer
  let cleaned = output.replace(/<\|im_end\|>/g, "").replace(/<\|im_start\|>/g, "");

  // Normalize: handle missing <tool_call> tag (known Qwen issue)
  // Use a two-pass approach:
  // 1. Mark existing <tool_call> openings with a sentinel
  // 2. Insert <tool_call> before bare <function= tags
  // 3. Remove sentinels
  const sentinel = "\0TOOL_CALL_PRESENT\0";
  let normalized = cleaned.replace(/<tool_call>\s*(<function=)/g, `${sentinel}$1`);
  normalized = normalized.replace(/<function=/g, "<tool_call>\n<function=");
  normalized = normalized.replace(new RegExp(sentinel.replace(/\0/g, "\\0"), "g"), "");

  // Normalize: handle missing </tool_call> closing tag
  // Also handles stop sequence cutting off </tool_call> — the model stops
  // generating at </tool_call> so it may not appear in the output
  normalized = normalized.replace(/<\/function>\s*(?!<\/tool_call>)/g, "</function>\n</tool_call>");

  // Handle truncated tool calls where </function> is also missing
  // (stop sequence fired mid-generation). Close any unclosed function blocks.
  if (normalized.includes("<function=") && !normalized.includes("</function>")) {
    normalized += "\n</function>\n</tool_call>";
  }

  // Extract all tool call blocks
  const blockRegex = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  const textParts: string[] = [];

  // Collect text before first tool call
  const firstToolCall = normalized.search(/<tool_call>/);
  if (firstToolCall > 0) {
    textParts.push(normalized.slice(0, firstToolCall));
  } else if (firstToolCall === -1) {
    return { text: cleaned.trim(), toolCalls: [] };
  }

  while ((match = blockRegex.exec(normalized)) !== null) {
    const name = match[1].trim();
    const body = match[2];
    const input: Record<string, string> = {};

    const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      input[paramMatch[1].trim()] = paramMatch[2].trim();
    }

    toolCalls.push(mapToolCall(name, input));
  }

  const text = textParts.join("").trim();
  return { text, toolCalls };
}
