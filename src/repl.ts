import readline from "node:readline";
import { chatCompletion, type ChatMessage } from "./client.js";
import { parseToolCalls } from "./parser.js";
import { executeTool } from "./tools.js";
import { buildSystemPrompt } from "./prompt.js";

export async function startRepl(model: string, port: number): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const systemPrompt = buildSystemPrompt(process.cwd());
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  console.log("Mallex Code v0.1.0 — type your request (Ctrl+C to exit)\n");

  const prompt = (): Promise<string> =>
    new Promise((resolve) => rl.question("> ", resolve));

  while (true) {
    const userInput = await prompt();
    if (!userInput.trim()) continue;

    messages.push({ role: "user", content: userInput });

    // Agentic loop: keep going while model makes tool calls
    let continueLoop = true;
    while (continueLoop) {
      const response = await chatCompletion(messages, model, port);
      const parsed = parseToolCalls(response.content);

      if (parsed.text) {
        console.log(`\n${parsed.text}\n`);
      }

      if (parsed.toolCalls.length === 0) {
        messages.push({ role: "assistant", content: response.content });
        continueLoop = false;
        break;
      }

      // Execute each tool call
      messages.push({ role: "assistant", content: response.content });

      for (const toolCall of parsed.toolCalls) {
        // Bash requires approval
        if (toolCall.name === "bash") {
          const approved = await new Promise<boolean>((resolve) => {
            rl.question(
              `Run command: ${toolCall.input.command} [y/N] `,
              (answer) => resolve(answer.toLowerCase() === "y"),
            );
          });
          if (!approved) {
            messages.push({
              role: "user",
              content: `Tool result for ${toolCall.name}: User denied execution.`,
            });
            continue;
          }
        }

        console.log(`  [${toolCall.name}] ${Object.values(toolCall.input)[0] ?? ""}`);
        const result = await executeTool(toolCall.name, toolCall.input);
        messages.push({
          role: "user",
          content: `Tool result for ${toolCall.name}:\n${result}`,
        });
      }
    }
  }
}
