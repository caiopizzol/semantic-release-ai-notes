import fs from "node:fs/promises";
import path from "node:path";
import type { GenerateNotesContext, PluginConfig } from "../types.js";
import { generateFallbackNotes } from "./fallback.js";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt.js";

export async function generateNotes(
	pluginConfig: PluginConfig,
	context: GenerateNotesContext,
): Promise<string> {
	const { commits, lastRelease, nextRelease, logger } = context;
	const cwd = context.cwd || process.cwd();

	// Read brand/voice file if it exists
	const brandFile = pluginConfig.brandFile ?? "brand.md";
	let brandContent: string | null = null;
	try {
		brandContent = await fs.readFile(path.resolve(cwd, brandFile), "utf-8");
	} catch {
		// No brand file — that's fine
	}

	const prompt = buildPrompt(
		commits,
		lastRelease,
		nextRelease,
		brandContent,
		pluginConfig,
	);

	try {
		// Dynamic import to avoid issues if the SDK isn't available at load time
		const { query } = await import("@anthropic-ai/claude-agent-sdk");

		const agentQuery = query({
			prompt,
			options: {
				allowedTools: ["Read", "Glob", "Grep", "Bash"],
				disallowedTools: ["Write", "Edit", "NotebookEdit"],
				cwd,
				model: pluginConfig.model || "claude-haiku-4-5-20251001",
				maxTurns: pluginConfig.maxTurns || 15,
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
				systemPrompt: SYSTEM_PROMPT,
			},
		});

		for await (const message of agentQuery) {
			if (message.type === "result") {
				if (message.subtype === "success" && message.result) {
					const cost =
						"total_cost_usd" in message
							? ` ($${(message.total_cost_usd as number).toFixed(4)})`
							: "";
					const turns =
						"num_turns" in message ? ` (${message.num_turns} turns)` : "";
					logger.log(`AI release notes generated${turns}${cost}`);
					return message.result;
				}

				logger.warn(`Agent ended with: ${message.subtype}`);
				break;
			}
		}
	} catch (error) {
		logger.warn(`AI notes generation failed: ${(error as Error).message}`);
	}

	// Fallback — never block a release
	logger.log("Falling back to commit-list notes.");
	return generateFallbackNotes(commits, nextRelease);
}
