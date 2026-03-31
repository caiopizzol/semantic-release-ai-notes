import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SYSTEM_PROMPT } from "../src/lib/prompt.js";

// --- GitHub Actions helpers ---

function getInput(name: string, fallback = ""): string {
	return (
		process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`]?.trim() ||
		fallback
	);
}

function setOutput(name: string, value: string): void {
	const file = process.env.GITHUB_OUTPUT;
	if (file) {
		const delim = `delim_${randomUUID()}`;
		appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
	}
}

// --- Git helpers ---

function git(cmd: string): string {
	return execSync(`git ${cmd}`, {
		encoding: "utf-8",
		maxBuffer: 10_000_000,
	}).trim();
}

function getRepoRoot(): string {
	try {
		return git("rev-parse --show-toplevel");
	} catch {
		return process.cwd();
	}
}

function detectPreviousTag(): string {
	try {
		return git("describe --tags --abbrev=0 HEAD^");
	} catch {
		return "";
	}
}

function detectCurrentTag(): string {
	try {
		return git("describe --tags --exact-match HEAD");
	} catch {
		return git("rev-parse --short HEAD");
	}
}

function getCommitLog(from: string, to: string): string {
	const range = from ? `${from}..${to}` : to;
	try {
		return git(`log --format="- %s (%h)" ${range}`);
	} catch {
		return "";
	}
}

// --- Prompt building ---

function buildPrompt(
	prevTag: string,
	curTag: string,
	commitLog: string,
	brandContent: string,
	style: string,
): string {
	const parts: string[] = [];

	const prev = prevTag
		? `Previous release: ${prevTag}.`
		: "This is the first release.";
	parts.push(`Generate release notes for ${curTag}. ${prev}`);

	parts.push(`\n## Commits in this release\n\n${commitLog}`);

	if (prevTag) {
		parts.push(
			"\n## Instructions\n",
			`Run \`git diff --stat ${prevTag}...${curTag}\` to see which files changed.`,
			"Then read the most important changed files to understand what was actually done.",
			"Use the commit hashes above to guide your exploration — but do not include them in the output.",
		);
	} else {
		parts.push(
			"\n## Instructions\n",
			"This is the first release. Read the project's README or main source files to understand what this project does, then summarize its initial capabilities.",
		);
	}

	if (brandContent) {
		parts.push(
			"\n## Voice & Tone Guide\n",
			"Match this tone when writing the notes:\n",
			brandContent,
		);
	}

	if (style === "concise") {
		parts.push(
			"\n## Style\n",
			"Keep notes brief — one sentence per change, no paragraphs. Bullet points only.",
		);
	} else {
		parts.push(
			"\n## Style\n",
			"You may include a short paragraph (2-3 sentences) for significant features. Use bullet points for smaller changes.",
		);
	}

	return parts.join("\n");
}

// --- Main ---

async function main(): Promise<void> {
	const model = getInput("model", "claude-haiku-4-5");
	const style = getInput("style", "concise");
	const maxTurns = getInput("max_turns", "15");
	const brandFile = getInput("brand_file", "brand.md");
	const updateRelease = getInput("update_release") === "true";

	const repoRoot = getRepoRoot();
	const prevTag = getInput("previous_tag") || detectPreviousTag();
	const curTag = detectCurrentTag();

	console.log(
		`Generating AI release notes for ${curTag}${prevTag ? ` (from ${prevTag})` : ""}`,
	);

	const commitLog = getCommitLog(prevTag, curTag);
	if (!commitLog) {
		console.log("No commits found.");
		setOutput("notes", "No notable changes.");
		return;
	}

	// Read brand file
	let brandContent = "";
	try {
		brandContent = readFileSync(resolve(repoRoot, brandFile), "utf-8");
	} catch {
		// No brand file — that's fine
	}

	const prompt = buildPrompt(prevTag, curTag, commitLog, brandContent, style);

	// Write system prompt to temp file
	const sysFile = join(tmpdir(), `sr-ai-notes-system-${randomUUID()}.txt`);
	writeFileSync(sysFile, SYSTEM_PROMPT);

	let notes = "";

	try {
		const result = spawnSync(
			"claude",
			[
				"-p",
				"--bare",
				"--model",
				model,
				"--max-turns",
				maxTurns,
				"--allowedTools",
				"Read,Glob,Grep,Bash",
				"--disallowedTools",
				"Write,Edit,NotebookEdit",
				"--append-system-prompt-file",
				sysFile,
				"--dangerously-skip-permissions",
				prompt,
			],
			{
				encoding: "utf-8",
				cwd: repoRoot,
				timeout: 300_000,
				maxBuffer: 10_000_000,
			},
		);

		if (result.status !== 0) {
			throw new Error(result.stderr || `Exit code ${result.status}`);
		}

		notes = result.stdout.trim();
		if (!notes) throw new Error("Empty response from Claude");

		console.log("AI release notes generated successfully.");
	} catch (err) {
		console.log(`::warning::AI generation failed: ${(err as Error).message}`);
		console.log("Falling back to commit-list notes.");
		notes = commitLog;
	}

	setOutput("notes", notes);

	// Update GitHub release if requested
	if (updateRelease) {
		const ghToken = process.env.GH_TOKEN;
		if (!ghToken) {
			console.log(
				"::warning::update-release is true but no github-token provided.",
			);
			return;
		}

		try {
			const notesFile = join(tmpdir(), `sr-ai-notes-${randomUUID()}.md`);
			writeFileSync(notesFile, notes);
			execSync(`gh release edit "${curTag}" --notes-file "${notesFile}"`, {
				encoding: "utf-8",
				env: { ...process.env, GH_TOKEN: ghToken },
			});
			console.log(`Updated GitHub release ${curTag}.`);
		} catch (err) {
			console.log(
				`::warning::Failed to update release: ${(err as Error).message}`,
			);
		}
	}
}

main().catch((err) => {
	console.log(`::error::${(err as Error).message}`);
	process.exit(1);
});
