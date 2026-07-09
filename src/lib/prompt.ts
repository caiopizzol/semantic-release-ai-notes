import type { Commit, PluginConfig, Release } from "../types.js";
import { RELEASE_NOTE_HEADINGS } from "./notes-schema.js";

export const SYSTEM_PROMPT = `You are a release notes writer. You generate clean, reader-friendly release-note data for software projects.

You have access to the codebase via tools. Use them to understand what actually changed — don't just rephrase commit messages.

Output requirements:
- Output ONLY structured data matching the configured JSON schema. No preamble, no explanation, no wrapping code fences.
- The root object has a sections array with at least one section.
- Each section heading must be one of: ${RELEASE_NOTE_HEADINGS.join(", ")}.
- Each section has at least one item with a non-empty title and non-empty description.

Content rules:
- Focus on what matters to users of this software.
- Group changes by theme using the schema headings as appropriate.
- Use item titles for feature or change names.
- Use item descriptions for the user-facing explanation.
- Write in present tense, active voice.
- Be specific about what changed, not vague.
- Do NOT include the version number as a heading or item title.
- Do NOT include commit hashes or links.
- If a voice/tone guide is provided, match its tone and style.
- Skip trivial changes (version bumps, CI config tweaks) unless they're the only changes.`;

export function buildPrompt(
	commits: ReadonlyArray<Commit>,
	lastRelease: Release,
	nextRelease: Release & { type: string },
	brandContent: string | null,
	config: PluginConfig,
): string {
	const parts: string[] = [];

	// Version context
	const prev = lastRelease.version
		? `Previous release: v${lastRelease.version}.`
		: "This is the first release.";
	parts.push(
		`Generate release notes for v${nextRelease.version} (${nextRelease.type} release). ${prev}`,
	);

	// Commits
	parts.push("\n## Commits in this release\n");
	for (const commit of commits) {
		let line = `- ${commit.subject} (${commit.hash.slice(0, 7)})`;
		if (commit.body?.trim()) {
			line += `\n  ${commit.body.trim()}`;
		}
		parts.push(line);
	}

	// Exploration instructions
	if (lastRelease.gitHead) {
		parts.push(
			`\n## Instructions\n`,
			`Run \`git diff --stat ${lastRelease.gitHead}...${nextRelease.gitHead}\` to see which files changed.`,
			`Then read the most important changed files to understand what was actually done.`,
			`Use the commit hashes above to guide your exploration — but do not include them in the output.`,
		);
	} else {
		parts.push(
			`\n## Instructions\n`,
			`This is the first release. Read the project's README or main source files to understand what this project does, then summarize its initial capabilities.`,
		);
	}

	// Brand/voice guidance
	if (brandContent) {
		parts.push(
			`\n## Voice & Tone Guide\n`,
			`The following is the project's brand and voice guide. Match this tone when writing the notes:\n`,
			brandContent,
		);
	}

	// Style
	const style = config.style || "concise";
	if (style === "concise") {
		parts.push(
			`\n## Style\n`,
			`Keep descriptions brief — one sentence per change.`,
		);
	} else {
		parts.push(
			`\n## Style\n`,
			`You may use 2-3 sentences in the description for significant features. Keep smaller changes to one sentence.`,
		);
	}

	return parts.join("\n");
}
