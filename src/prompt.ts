import { TOOL_DEFINITIONS, type ToolDefinition, type ToolParameter } from "./tool-definitions.js";

/**
 * Format a single tool definition as XML for injection into the system prompt.
 */
function formatParamXml(name: string, p: ToolParameter): string {
  let attrs = `name="${name}" type="${p.type}" required="${!!p.required}"`;
  if (p.enum) attrs += ` enum="${p.enum.join(",")}"`;
  return `  <parameter ${attrs}>${p.description}</parameter>`;
}

function formatToolXml(tool: ToolDefinition): string {
  const params = Object.entries(tool.parameters)
    .map(([name, p]) => formatParamXml(name, p))
    .join("\n");
  return `<tool name="${tool.name}">\n  <description>${tool.description}</description>\n${params}\n</tool>`;
}

/**
 * Build the XML tool definitions block that gets injected into the system prompt.
 * This teaches the model the tool_call format and lists available tools.
 */
export function buildToolInjection(): string {
  const toolsXml = TOOL_DEFINITIONS.map(formatToolXml).join("\n\n");

  return [
    "",
    "## Tools",
    "",
    "You have access to the following tools. To use a tool, output a tool_call block in this exact format:",
    "",
    "<tool_call>",
    "<function=tool_name>",
    "<parameter=param_name>value</parameter>",
    "</function>",
    "</tool_call>",
    "",
    "CRITICAL RULES:",
    "- Only use tools when the task involves files, the filesystem, or running commands.",
    "- For general knowledge questions, answer directly WITHOUT using tools.",
    "- NEVER guess or hallucinate file contents — use tools to read them.",
    "- Always include the opening <tool_call> tag. Never omit it.",
    "- You may include text before a tool call to explain what you're doing.",
    "- After a tool call, STOP and wait for the result before continuing.",
    "",
    "EFFICIENT TOOL USE:",
    "- For counting files/lines/matches, use bash with wc or grep with output_mode=\"count\" — do NOT use glob or grep to list everything and count manually.",
    "- Use head_limit to cap grep/glob results. Only request what you need.",
    "- Prefer targeted queries over broad scans. \"grep pattern specific_file.ts\" not \"grep pattern .\"",
    "- Bash output over 30000 chars will be truncated. Use pipes (| head, | wc -l, | grep) to reduce output.",
    "",
    "<tools>",
    toolsXml,
    "</tools>",
  ].join("\n");
}

/**
 * Inject tool definitions into a system prompt from Claude Code.
 * Appends the tool_call format instructions and tool definitions in XML.
 */
export function injectToolDefinitions(systemPrompt: string): string {
  return systemPrompt + "\n" + buildToolInjection();
}
