import readline from "node:readline";
import {
  DEFAULT_ROUTING_RULES,
  defaultTierModels,
  type IntentCategory,
  type ModelTierNumber,
  type RoutingConfig,
  type RoutingRule,
  type TierModel,
} from "./config.js";

export interface RouterSetupDeps {
  promptUser: (question: string) => Promise<string>;
  log: (message: string) => void;
}

export interface RouterSetupResult {
  routing: RoutingConfig;
}

function friendlyModelName(tierModel: TierModel, localModel: string): string {
  if (tierModel.target === "local") return `${localModel} (local)`;
  const name = tierModel.claudeModel ?? "unknown";
  if (name.includes("opus")) return "Claude Opus 4.6";
  if (name.includes("sonnet")) return "Claude Sonnet 4.5";
  return name;
}

const TIER_LABELS: Record<ModelTierNumber, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};

export async function runRouterSetupWithDeps(
  localModel: string,
  deps: RouterSetupDeps,
): Promise<RouterSetupResult> {
  const tierDefaults = defaultTierModels(localModel);

  deps.log("\n--- Intent-Based Routing Setup ---\n");
  deps.log(`Your local model: ${localModel}`);

  deps.log("\nEffort tiers:");
  for (const tier of [1, 2, 3] as ModelTierNumber[]) {
    const label = TIER_LABELS[tier];
    const friendly = friendlyModelName(tierDefaults[tier], localModel);
    deps.log(`  ${label.padEnd(8)} ${friendly}`);
  }

  deps.log("\nCategory routing (automatic):");
  deps.log("  chit_chat      → Low");
  deps.log("  simple_code    → Low");
  deps.log("  hard_question  → High");
  deps.log("  try_again      → Escalates from previous tier");
  deps.log("");

  const acceptAnswer = await deps.promptUser("Accept defaults? (Y/n) ");
  const accept = acceptAnswer.trim().toLowerCase();

  let tiers: Record<ModelTierNumber, TierModel>;

  if (accept === "" || accept === "y" || accept === "yes") {
    tiers = { ...tierDefaults };
  } else {
    tiers = {} as Record<ModelTierNumber, TierModel>;
    for (const tierNum of [1, 2, 3] as ModelTierNumber[]) {
      const label = TIER_LABELS[tierNum];
      const def = tierDefaults[tierNum];
      const defaultDisplay = def.target === "local" ? "local" : (def.claudeModel ?? "unknown");
      const answer = await deps.promptUser(
        `${label} tier - enter 'local' or a Claude model ID [${defaultDisplay}]: `,
      );
      const trimmed = answer.trim();
      if (trimmed === "" || trimmed === defaultDisplay) {
        tiers[tierNum] = { ...def };
      } else if (trimmed === "local") {
        tiers[tierNum] = { target: "local" };
      } else {
        tiers[tierNum] = { target: "claude", claudeModel: trimmed };
      }
    }
  }

  const needsClaude = Object.values(tiers).some((t) => t.target === "claude");
  if (needsClaude) {
    deps.log("Claude escalation will use your Claude Code login (Pro/Max).");
    deps.log("Make sure you're logged into Claude Code first (just run 'claude' once).");
  }

  return {
    routing: {
      rules: DEFAULT_ROUTING_RULES,
      tiers,
      authMethod: needsClaude ? "oauth" : undefined,
    },
  };
}

export async function runRouterSetup(localModel: string): Promise<RouterSetupResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = (question: string): Promise<string> =>
    new Promise<string>((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer);
      });
    });

  try {
    return await runRouterSetupWithDeps(localModel, {
      promptUser,
      log: console.log,
    });
  } finally {
    rl.close();
  }
}
