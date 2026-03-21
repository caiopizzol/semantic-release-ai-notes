import { beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GenerateNotesContext } from "../types.js";
import { _resetCache, getRepoRoot } from "./generate-notes.js";

function makeContext(
	overrides: Partial<GenerateNotesContext> = {},
): GenerateNotesContext {
	return {
		cwd: "/tmp/test-repo",
		logger: { log: () => {}, warn: () => {}, error: () => {} },
		commits: [
			{
				hash: "abc1234",
				subject: "feat: add cool feature",
				body: "",
				message: "feat: add cool feature",
			},
		],
		lastRelease: { version: "1.0.0", gitTag: "v1.0.0", gitHead: "aaa1111" },
		nextRelease: {
			version: "1.1.0",
			gitTag: "v1.1.0",
			gitHead: "bbb2222",
			type: "minor",
		},
		...overrides,
	};
}

/** Create a temp git repo and return its root path */
function createTempGitRepo(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "sr-ai-notes-test-"));
	execSync("git init", { cwd: root, stdio: "ignore" });
	execSync("git config user.email test@test.com", {
		cwd: root,
		stdio: "ignore",
	});
	execSync("git config user.name Test", { cwd: root, stdio: "ignore" });
	// Need at least one commit for git rev-parse to work reliably
	fs.writeFileSync(path.join(root, "README.md"), "# test");
	execSync("git add . && git commit -m 'init'", { cwd: root, stdio: "ignore" });
	return root;
}

describe("generateNotes", () => {
	beforeEach(() => {
		_resetCache();
	});

	test("returns agent result on success", async () => {
		const mockNotes = "### What's New\n\n- **Cool feature** — does cool things";

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: () =>
				(async function* () {
					yield {
						type: "result",
						subtype: "success",
						result: mockNotes,
						num_turns: 3,
						total_cost_usd: 0.02,
					};
				})(),
		}));

		// Re-import to pick up the mock
		const { generateNotes } = await import("./generate-notes.js");
		const result = await generateNotes({}, makeContext());
		expect(result).toBe(mockNotes);
	});

	test("falls back on agent error", async () => {
		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: () => {
				throw new Error("API key invalid");
			},
		}));

		const { generateNotes } = await import("./generate-notes.js");
		const result = await generateNotes({}, makeContext());

		// Should get fallback notes
		expect(result).toContain("add cool feature");
	});

	test("falls back on non-success result", async () => {
		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: () =>
				(async function* () {
					yield {
						type: "result",
						subtype: "error_max_turns",
						result: null,
					};
				})(),
		}));

		const { generateNotes } = await import("./generate-notes.js");
		const result = await generateNotes({}, makeContext());
		expect(result).toContain("add cool feature");
	});

	test("returns cached result on second call", async () => {
		const mockNotes = "### Cached notes";
		let callCount = 0;

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: () => {
				callCount++;
				return (async function* () {
					yield {
						type: "result",
						subtype: "success",
						result: mockNotes,
					};
				})();
			},
		}));

		const { generateNotes } = await import("./generate-notes.js");
		const first = await generateNotes({}, makeContext());
		const second = await generateNotes({}, makeContext());

		expect(first).toBe(mockNotes);
		expect(second).toBe(mockNotes);
		expect(callCount).toBe(1); // Agent only called once
	});
});

describe("getRepoRoot", () => {
	test("returns git root from repo root", () => {
		const root = createTempGitRepo();
		const result = getRepoRoot(root);
		// Resolve symlinks (macOS /tmp -> /private/tmp)
		expect(fs.realpathSync(result)).toBe(fs.realpathSync(root));
	});

	test("returns git root from a subdirectory", () => {
		const root = createTempGitRepo();
		const sub = path.join(root, "packages", "my-lib");
		fs.mkdirSync(sub, { recursive: true });

		const result = getRepoRoot(sub);
		expect(fs.realpathSync(result)).toBe(fs.realpathSync(root));
	});

	test("returns git root from deeply nested subdirectory", () => {
		const root = createTempGitRepo();
		const deep = path.join(root, "packages", "layout-engine", "src", "lib");
		fs.mkdirSync(deep, { recursive: true });

		const result = getRepoRoot(deep);
		expect(fs.realpathSync(result)).toBe(fs.realpathSync(root));
	});

	test("falls back to cwd when not in a git repo", () => {
		const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), "no-git-"));
		const result = getRepoRoot(nonGit);
		expect(result).toBe(nonGit);
	});
});

describe("monorepo support", () => {
	beforeEach(() => {
		_resetCache();
	});

	test("reads brand.md from repo root when cwd is a subdirectory", async () => {
		const root = createTempGitRepo();
		const packageDir = path.join(root, "packages", "my-lib");
		fs.mkdirSync(packageDir, { recursive: true });

		// brand.md at repo root only
		fs.writeFileSync(path.join(root, "brand.md"), "Be bold and direct.");

		let capturedPrompt = "";

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: (opts: { prompt: string }) => {
				capturedPrompt = opts.prompt;
				return (async function* () {
					yield {
						type: "result",
						subtype: "success",
						result: "### Notes",
					};
				})();
			},
		}));

		const { generateNotes } = await import("./generate-notes.js");
		await generateNotes({}, makeContext({ cwd: packageDir }));

		// The prompt should contain the brand content from repo root
		expect(capturedPrompt).toContain("Be bold and direct.");
	});

	test("does NOT find brand.md when it only exists in the package dir (not repo root)", async () => {
		const root = createTempGitRepo();
		const packageDir = path.join(root, "packages", "my-lib");
		fs.mkdirSync(packageDir, { recursive: true });

		// brand.md in package dir only — should NOT be found
		// (the plugin resolves from repo root, not cwd)
		fs.writeFileSync(path.join(packageDir, "brand.md"), "Package-level brand.");

		let capturedPrompt = "";

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: (opts: { prompt: string }) => {
				capturedPrompt = opts.prompt;
				return (async function* () {
					yield {
						type: "result",
						subtype: "success",
						result: "### Notes",
					};
				})();
			},
		}));

		const { generateNotes } = await import("./generate-notes.js");
		await generateNotes({}, makeContext({ cwd: packageDir }));

		// Brand content from package dir should NOT appear
		expect(capturedPrompt).not.toContain("Package-level brand.");
		expect(capturedPrompt).not.toContain("Voice & Tone Guide");
	});

	test("passes repo root (not package dir) as agent cwd", async () => {
		const root = createTempGitRepo();
		const packageDir = path.join(root, "packages", "my-lib");
		fs.mkdirSync(packageDir, { recursive: true });

		let capturedCwd = "";

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: (opts: { options: { cwd: string } }) => {
				capturedCwd = opts.options.cwd;
				return (async function* () {
					yield {
						type: "result",
						subtype: "success",
						result: "### Notes",
					};
				})();
			},
		}));

		const { generateNotes } = await import("./generate-notes.js");
		await generateNotes({}, makeContext({ cwd: packageDir }));

		// Agent cwd should be the repo root, not the package directory
		expect(fs.realpathSync(capturedCwd)).toBe(fs.realpathSync(root));
		expect(capturedCwd).not.toBe(packageDir);
	});

	test("works when cwd IS the repo root (non-monorepo)", async () => {
		const root = createTempGitRepo();
		fs.writeFileSync(path.join(root, "brand.md"), "Root brand.");

		let capturedCwd = "";
		let capturedPrompt = "";

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: (opts: { prompt: string; options: { cwd: string } }) => {
				capturedCwd = opts.options.cwd;
				capturedPrompt = opts.prompt;
				return (async function* () {
					yield {
						type: "result",
						subtype: "success",
						result: "### Notes",
					};
				})();
			},
		}));

		const { generateNotes } = await import("./generate-notes.js");
		await generateNotes({}, makeContext({ cwd: root }));

		expect(fs.realpathSync(capturedCwd)).toBe(fs.realpathSync(root));
		expect(capturedPrompt).toContain("Root brand.");
	});

	test("custom brandFile resolves from repo root", async () => {
		const root = createTempGitRepo();
		const packageDir = path.join(root, "packages", "my-lib");
		fs.mkdirSync(packageDir, { recursive: true });

		// Custom brand file at repo root
		fs.mkdirSync(path.join(root, "docs"), { recursive: true });
		fs.writeFileSync(path.join(root, "docs", "voice.md"), "Friendly tone.");

		let capturedPrompt = "";

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: (opts: { prompt: string }) => {
				capturedPrompt = opts.prompt;
				return (async function* () {
					yield {
						type: "result",
						subtype: "success",
						result: "### Notes",
					};
				})();
			},
		}));

		const { generateNotes } = await import("./generate-notes.js");
		await generateNotes(
			{ brandFile: "docs/voice.md" },
			makeContext({ cwd: packageDir }),
		);

		expect(capturedPrompt).toContain("Friendly tone.");
	});
});
