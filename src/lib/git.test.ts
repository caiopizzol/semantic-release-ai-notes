import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Commit } from "../types.js";
import {
	filterCommitsByScope,
	getPackagePath,
	readPackageName,
	resolveScopeName,
} from "./git.js";

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();
}

function write(root: string, file: string, content: string): void {
	const target = path.join(root, file);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content);
}

function commit(root: string, subject: string): Commit {
	git(root, "add", ".");
	git(root, "commit", "-m", subject);
	const hash = git(root, "rev-parse", "HEAD");
	return { hash, subject, body: "", message: subject };
}

describe("package scope git helpers", () => {
	let root = "";
	let coreCommit: Commit;
	let cliCommit: Commit;
	let unrelatedCommit: Commit;
	let mergeCommit: Commit;

	beforeAll(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "sr-ai-notes-git-"));
		git(root, "init", "-b", "main");
		git(root, "config", "user.email", "test@example.com");
		git(root, "config", "user.name", "Test User");
		write(root, "packages/cli/package.json", '{"name":"@superdoc/cli"}');
		write(root, "packages/core/index.ts", "export const core = 1;\n");
		write(root, "packages/other/index.ts", "export const other = 1;\n");
		commit(root, "chore: initialize fixture");

		write(root, "packages/core/index.ts", "export const core = 2;\n");
		coreCommit = commit(root, "feat(core): improve shared engine");
		write(root, "packages/cli/index.ts", "export const cli = true;\n");
		cliCommit = commit(root, "feat(cli): add command");
		write(root, "packages/other/index.ts", "export const other = 2;\n");
		unrelatedCommit = commit(root, "feat(other): unrelated package change");

		git(root, "checkout", "-b", "cli-merge");
		write(root, "packages/cli/merge.ts", "export const merged = true;\n");
		commit(root, "feat(cli): prepare merged command");
		git(root, "checkout", "main");
		write(root, "README.md", "# Fixture\n");
		commit(root, "docs: update root readme");
		git(root, "merge", "--no-ff", "cli-merge", "-m", "merge: cli command");
		const hash = git(root, "rev-parse", "HEAD");
		mergeCommit = {
			hash,
			subject: "merge: cli command",
			body: "",
			message: "merge: cli command",
		};
	});

	afterAll(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	test("reads the default name and keeps an explicit override", () => {
		const cwd = path.join(root, "packages/cli");
		expect(readPackageName(cwd)).toBe("@superdoc/cli");
		expect(resolveScopeName({ paths: ["packages/cli"] }, cwd).name).toBe(
			"@superdoc/cli",
		);
		expect(
			resolveScopeName({ name: "SuperDoc CLI", paths: ["packages/cli"] }, cwd)
				.name,
		).toBe("SuperDoc CLI");
		expect(getPackagePath(root, cwd)).toBe("packages/cli");
		expect(getPackagePath(root, root)).toBe(".");
	});

	test("intersects semantic-release commits with scoped paths and retains merges", () => {
		const selected = filterCommitsByScope(
			[coreCommit, cliCommit, unrelatedCommit, mergeCommit],
			["packages/cli", "packages/core"],
			root,
		);
		expect(selected.map((entry) => entry.hash)).toEqual([
			coreCommit.hash,
			cliCommit.hash,
			mergeCommit.hash,
		]);
	});

	test("returns an empty intersection when selected commits do not touch the scope", () => {
		expect(
			filterCommitsByScope([unrelatedCommit], ["packages/cli"], root),
		).toEqual([]);
	});
});
