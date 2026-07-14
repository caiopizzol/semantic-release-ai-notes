import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateFallbackNotes } from "../src/lib/fallback.js";
import {
	filterCommitsByScope,
	getPackagePath,
	getRepoRoot,
	resolveScopeName,
} from "../src/lib/git.js";
import {
	releaseNotesSchema,
	renderNotes,
	validateReleaseNotes,
} from "../src/lib/notes-schema.js";
import { buildPrompt, SYSTEM_PROMPT } from "../src/lib/prompt.js";
import { validateScope } from "../src/lib/scope.js";
import type { Commit, Release, ReleaseScope } from "../src/types.js";

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

function git(args: string[], cwd = process.cwd()): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		maxBuffer: 10_000_000,
	}).trim();
}

function detectPreviousTag(): string {
	try {
		return git(["describe", "--tags", "--abbrev=0", "HEAD^"]);
	} catch {
		return "";
	}
}

function detectCurrentTag(): string {
	try {
		return git(["describe", "--tags", "--exact-match", "HEAD"]);
	} catch {
		return git(["rev-parse", "--short", "HEAD"]);
	}
}

function getCommits(from: string, to: string, repoRoot: string): Commit[] {
	const range = from ? `${from}..${to}` : to;
	try {
		const log = git(["log", "--format=%H%x1f%s", range], repoRoot);
		if (!log) return [];
		return log.split("\n").map((line) => {
			const [hash = "", subject = ""] = line.split("\x1f", 2);
			return { hash, subject, body: "", message: subject };
		});
	} catch {
		return [];
	}
}

function formatCommitLog(commits: ReadonlyArray<Commit>): string {
	return commits
		.map((commit) => `- ${commit.subject} (${commit.hash.slice(0, 7)})`)
		.join("\n");
}

export function parseScopePaths(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function parseActionScope({
	name,
	paths,
	audience,
	instructions,
}: {
	name: string;
	paths: string;
	audience: string;
	instructions: string;
}): ReleaseScope | undefined {
	if (!name && !paths && !audience && !instructions) return undefined;
	return validateScope({
		name: name || undefined,
		paths: parseScopePaths(paths),
		audience: audience || undefined,
		instructions: instructions || undefined,
	});
}

export function buildActionPrompt({
	prevTag,
	curTag,
	commitLog,
	brandContent,
	style,
	scope,
	packagePath,
}: {
	prevTag: string;
	curTag: string;
	commitLog: string;
	brandContent: string;
	style: "concise" | "detailed";
	scope?: ReleaseScope;
	packagePath?: string;
}): string {
	return buildPrompt({
		commits: commitLog ? commitLog.split("\n") : [],
		lastRelease: {
			version: prevTag,
			gitTag: prevTag,
			gitHead: prevTag,
		},
		nextRelease: {
			version: curTag,
			gitTag: curTag,
			gitHead: curTag,
		},
		brandContent,
		style,
		scope,
		packagePath,
	});
}

export function buildClaudeArgs({
	model,
	maxTurns,
	sysFile,
	prompt,
}: {
	model: string;
	maxTurns: string;
	sysFile: string;
	prompt: string;
}): string[] {
	return [
		"-p",
		"--bare",
		"--json-schema",
		JSON.stringify(releaseNotesSchema),
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
	];
}

export function renderClaudeStructuredOutput(stdout: string): string {
	const trimmed = stdout.trim();
	if (!trimmed) throw new Error("Empty response from Claude");

	const parsed: unknown = JSON.parse(trimmed);
	if (!validateReleaseNotes(parsed)) {
		throw new Error("Claude returned invalid structured release notes");
	}

	return renderNotes(parsed);
}

export function renderClaudeStructuredOutputOrFallback(
	stdout: string,
	commitLog: string,
): string {
	try {
		return renderClaudeStructuredOutput(stdout);
	} catch {
		return commitLog;
	}
}

// --- Main ---

async function main(): Promise<void> {
	const model = getInput("model", "claude-haiku-4-5");
	const style = getInput("style", "concise");
	const maxTurns = getInput("max_turns", "15");
	const brandFile = getInput("brand_file", "brand.md");
	const updateRelease = getInput("update_release") === "true";
	const configuredScope = parseActionScope({
		name: getInput("scope_name"),
		paths: getInput("scope_paths"),
		audience: getInput("scope_audience"),
		instructions: getInput("scope_instructions"),
	});

	const cwd = process.cwd();
	const repoRoot = getRepoRoot(cwd);
	const scope = configuredScope
		? resolveScopeName(configuredScope, cwd)
		: undefined;
	const packagePath = scope ? getPackagePath(repoRoot, cwd) : undefined;
	const prevTag = getInput("previous_tag") || detectPreviousTag();
	const curTag = detectCurrentTag();

	console.log(
		`Generating AI release notes for ${curTag}${prevTag ? ` (from ${prevTag})` : ""}`,
	);

	const releaseCommits = getCommits(prevTag, curTag, repoRoot);
	const commits = scope
		? filterCommitsByScope(releaseCommits, scope.paths, repoRoot)
		: releaseCommits;
	const commitLog = formatCommitLog(commits);
	if (!commitLog && !scope) {
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

	const nextRelease: Release & { type: string } = {
		version: curTag,
		gitTag: curTag,
		gitHead: curTag,
		type: "",
	};
	const prompt = buildActionPrompt({
		prevTag,
		curTag,
		commitLog,
		brandContent,
		style: style === "detailed" ? "detailed" : "concise",
		scope,
		packagePath,
	});

	// Write system prompt to temp file
	const sysFile = join(tmpdir(), `sr-ai-notes-system-${randomUUID()}.txt`);
	writeFileSync(sysFile, SYSTEM_PROMPT);

	let notes = "";

	try {
		const result = spawnSync(
			"claude",
			buildClaudeArgs({ model, maxTurns, sysFile, prompt }),
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

		notes = renderClaudeStructuredOutput(result.stdout);

		console.log("AI release notes generated successfully.");
	} catch (err) {
		console.log(`::warning::AI generation failed: ${(err as Error).message}`);
		console.log("Falling back to commit-list notes.");
		notes = scope
			? generateFallbackNotes(commits, nextRelease, scope)
			: commitLog;
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
			execFileSync(
				"gh",
				["release", "edit", curTag, "--notes-file", notesFile],
				{
					encoding: "utf-8",
					env: { ...process.env, GH_TOKEN: ghToken },
				},
			);
			console.log(`Updated GitHub release ${curTag}.`);
		} catch (err) {
			console.log(
				`::warning::Failed to update release: ${(err as Error).message}`,
			);
		}
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((err) => {
		console.log(`::error::${(err as Error).message}`);
		process.exit(1);
	});
}
