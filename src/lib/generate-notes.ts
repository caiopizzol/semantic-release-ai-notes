import fs from "node:fs/promises";
import path from "node:path";
import type { GenerateNotesContext, PluginConfig } from "../types.js";
import { generateFallbackNotes } from "./fallback.js";
import {
	filterCommitsByScope,
	getPackagePath,
	getRepoRoot,
	resolveScopeName,
} from "./git.js";
import {
	releaseNotesSchema,
	renderNotes,
	validateReleaseNotes,
} from "./notes-schema.js";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { validateScope } from "./scope.js";

// Cache the result — semantic-release calls generateNotes twice
// (before and after @semantic-release/git's version commit)
let cachedNotes: string | null = null;

/** Reset cache — exposed for testing */
export function _resetCache() {
	cachedNotes = null;
}

export { getRepoRoot } from "./git.js";

export async function generateNotes(
	pluginConfig: PluginConfig,
	context: GenerateNotesContext,
): Promise<string> {
	const { commits, lastRelease, nextRelease, logger } = context;
	const cwd = context.cwd || process.cwd();
	const repoRoot = getRepoRoot(cwd);
	const validatedScope = validateScope(pluginConfig.scope);
	const scope = validatedScope
		? resolveScopeName(validatedScope, cwd)
		: undefined;
	const packagePath = scope ? getPackagePath(repoRoot, cwd) : undefined;
	const relevantCommits = scope
		? filterCommitsByScope(commits, scope.paths, repoRoot)
		: commits;

	if (cachedNotes) {
		logger.log("Returning cached AI release notes.");
		return cachedNotes;
	}

	// Read brand/voice file if it exists — resolve from repo root so monorepo
	// packages can find a root-level brand.md
	const brandFile = pluginConfig.brandFile ?? "brand.md";
	let brandContent: string | null = null;
	try {
		brandContent = await fs.readFile(
			path.resolve(repoRoot, brandFile),
			"utf-8",
		);
	} catch {
		// No brand file — that's fine
	}

	const prompt = buildPrompt({
		commits: relevantCommits,
		lastRelease,
		nextRelease,
		brandContent,
		style: pluginConfig.style,
		scope,
		packagePath,
	});

	try {
		// Dynamic import to avoid issues if the SDK isn't available at load time
		const { query } = await import("@anthropic-ai/claude-agent-sdk");

		const agentQuery = query({
			prompt,
			options: {
				allowedTools: ["Read", "Glob", "Grep", "Bash"],
				disallowedTools: ["Write", "Edit", "NotebookEdit"],
				cwd: repoRoot,
				model: pluginConfig.model || "claude-haiku-4-5",
				maxTurns: pluginConfig.maxTurns || 15,
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
				systemPrompt: SYSTEM_PROMPT,
				outputFormat: {
					type: "json_schema",
					schema: releaseNotesSchema,
				},
			},
		});

		for await (const message of agentQuery) {
			if (message.type === "result") {
				if (message.subtype === "success") {
					if (!validateReleaseNotes(message.structured_output)) {
						logger.warn("Agent returned invalid structured release notes.");
						break;
					}

					const cost =
						"total_cost_usd" in message
							? ` ($${(message.total_cost_usd as number).toFixed(4)})`
							: "";
					const turns =
						"num_turns" in message ? ` (${message.num_turns} turns)` : "";
					logger.log(`AI release notes generated${turns}${cost}`);
					cachedNotes = renderNotes(message.structured_output);
					return cachedNotes;
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
	return generateFallbackNotes(relevantCommits, nextRelease, scope);
}
