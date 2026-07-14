import type { Commit, Release, ReleaseScope } from "../types.js";
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

export interface BuildPromptOptions {
	commits: ReadonlyArray<Commit | string>;
	lastRelease: Release;
	nextRelease: Release & { type?: string };
	brandContent: string | null;
	style?: "concise" | "detailed";
	scope?: ReleaseScope;
	packagePath?: string;
}

function shellArgument(value: string): string {
	if (/^[A-Za-z0-9_./@+-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildScopeGuidance({
	scope,
	packagePath,
}: {
	scope: ReleaseScope;
	packagePath: string;
}): string[] {
	const packageName = scope.name ?? "this package";
	const audience = scope.audience ?? `users of ${packageName}`;
	const guidance = [
		`These release notes are specifically for ${packageName}, located at \`${packagePath}\`.`,
		`Write for ${audience}.`,
		"Distinguish direct changes to this package from inherited changes in shared code or dependencies.",
		"Include inherited changes only when they are observable by users of this package.",
		"If nothing user-observable changed, emit a single concise dependency-update note instead of general repository changes.",
	];
	if (scope.instructions) {
		guidance.push(`Additional scope instructions: ${scope.instructions}`);
	}
	return guidance;
}

export function buildPrompt({
	commits,
	lastRelease,
	nextRelease,
	brandContent,
	style = "concise",
	scope,
	packagePath = ".",
}: BuildPromptOptions): string {
	const parts: string[] = [];

	// Version context
	const previousRelease = nextRelease.type
		? `v${lastRelease.version}`
		: lastRelease.gitTag || lastRelease.version;
	const prev =
		lastRelease.version || lastRelease.gitTag
			? `Previous release: ${previousRelease}.`
			: "This is the first release.";
	const releaseDescription = nextRelease.type
		? `v${nextRelease.version} (${nextRelease.type} release)`
		: nextRelease.gitTag || nextRelease.version;
	parts.push(`Generate release notes for ${releaseDescription}. ${prev}`);

	// Commits
	parts.push("\n## Commits in this release\n");
	for (const commit of commits) {
		if (typeof commit === "string") {
			parts.push(commit);
			continue;
		}
		let line = `- ${commit.subject} (${commit.hash.slice(0, 7)})`;
		if (commit.body?.trim()) {
			line += `\n  ${commit.body.trim()}`;
		}
		parts.push(line);
	}

	// Exploration instructions
	if (lastRelease.gitHead) {
		const diffPaths = scope
			? ` -- ${scope.paths.map(shellArgument).join(" ")}`
			: "";
		parts.push(
			`\n## Instructions\n`,
			`Run \`git diff --stat ${lastRelease.gitHead}...${nextRelease.gitHead}${diffPaths}\` to see which files changed.`,
			`Then read the most important changed files to understand what was actually done.`,
			`Use the commit hashes above to guide your exploration — but do not include them in the output.`,
		);
	} else {
		parts.push(
			`\n## Instructions\n`,
			`This is the first release. Read the project's README or main source files to understand what this project does, then summarize its initial capabilities.`,
		);
	}

	if (scope) {
		parts.push(
			`\n## Release Scope\n`,
			...buildScopeGuidance({ scope, packagePath }),
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
