import SemanticReleaseError from "@semantic-release/error";
import type { PluginConfig, VerifyConditionsContext } from "../types.js";

export async function verifyConditions(
	pluginConfig: PluginConfig,
	context: VerifyConditionsContext,
): Promise<void> {
	const apiKey =
		context.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;

	if (!apiKey) {
		throw new SemanticReleaseError(
			"ANTHROPIC_API_KEY environment variable is not set.",
			"ENOANTHROPICKEY",
			"Set ANTHROPIC_API_KEY in your CI environment to enable AI-powered release notes.",
		);
	}

	if (pluginConfig.model !== undefined && typeof pluginConfig.model !== "string") {
		throw new SemanticReleaseError(
			"Invalid model configuration.",
			"EINVALIDMODEL",
			"The 'model' option must be a string (e.g. 'claude-sonnet-4-20250514').",
		);
	}

	context.logger.log("semantic-release-ai-notes: ANTHROPIC_API_KEY verified.");
}
