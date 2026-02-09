export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read file contents with line numbers. Reads up to 2000 lines by default. Can also read images and PDFs.",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      offset: { type: "number", description: "Line number to start from (1-based)" },
      limit: { type: "number", description: "Max lines to read" },
      pages: { type: "string", description: "Page range for PDF files (e.g. \"1-5\"). Max 20 pages per request." },
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      content: { type: "string", description: "Content to write", required: true },
    },
  },
  {
    name: "edit_file",
    description: "Replace a string in a file. old_string must be unique in the file unless replace_all is true.",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      old_string: { type: "string", description: "Text to find", required: true },
      new_string: { type: "string", description: "Replacement text", required: true },
      replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
    },
  },
  {
    name: "bash",
    description: "Execute a shell command and return output. If output exceeds 30000 characters, it will be truncated.",
    parameters: {
      command: { type: "string", description: "The command to execute", required: true },
      description: { type: "string", description: "Short description of what this command does" },
      timeout: { type: "number", description: "Timeout in milliseconds (max 600000)" },
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern",
    parameters: {
      pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)", required: true },
      path: { type: "string", description: "Directory to search in" },
    },
  },
  {
    name: "grep",
    description: "Search file contents with a regex pattern. Supports filtering by file type/glob and limiting output.",
    parameters: {
      pattern: { type: "string", description: "Regex pattern to search for", required: true },
      path: { type: "string", description: "File or directory to search in" },
      output_mode: {
        type: "string",
        description: "Output mode: content (matching lines), files_with_matches (file paths only), count (match counts)",
        enum: ["content", "files_with_matches", "count"],
      },
      head_limit: { type: "number", description: "Limit output to first N lines/entries" },
      offset: { type: "number", description: "Skip first N lines/entries before applying head_limit" },
      glob: { type: "string", description: "Glob pattern to filter files (e.g. \"*.ts\")" },
      type: { type: "string", description: "File type to search (e.g. js, py, rust)" },
      "-i": { type: "boolean", description: "Case insensitive search" },
      "-A": { type: "number", description: "Lines to show after each match" },
      "-B": { type: "number", description: "Lines to show before each match" },
      "-C": { type: "number", description: "Lines of context around each match" },
      context: { type: "number", description: "Alias for -C" },
      multiline: { type: "boolean", description: "Enable multiline matching" },
    },
  },
  {
    name: "web_search",
    description: "Search the web and return results. Use for current events or information beyond your knowledge.",
    parameters: {
      query: { type: "string", description: "The search query", required: true },
      allowed_domains: { type: "string", description: "Comma-separated list of domains to include" },
      blocked_domains: { type: "string", description: "Comma-separated list of domains to exclude" },
    },
  },
  {
    name: "web_fetch",
    description: "Fetch content from a URL and process it. Returns markdown-converted content.",
    parameters: {
      url: { type: "string", description: "The URL to fetch", required: true },
      prompt: { type: "string", description: "What information to extract from the page", required: true },
    },
  },
  {
    name: "ask_user",
    description: "Ask the user a question and wait for their response. Use to clarify requirements or get decisions.",
    parameters: {
      question: { type: "string", description: "The question to ask the user", required: true },
    },
  },
];
