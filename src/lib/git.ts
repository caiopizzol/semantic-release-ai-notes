import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Commit, ReleaseScope } from "../types.js";

function runGit(args: string[], cwd: string): string | null {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		maxBuffer: 10_000_000,
	});
	if (result.status !== 0 || result.error) return null;
	return result.stdout.trim();
}

export function getRepoRoot(cwd: string): string {
	return runGit(["rev-parse", "--show-toplevel"], cwd) || cwd;
}

export function getPackagePath(repoRoot: string, cwd: string): string {
	const relative = path.relative(repoRoot, cwd);
	return relative ? relative.split(path.sep).join("/") : ".";
}

export function readPackageName(cwd: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(
			fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		const name = (parsed as Record<string, unknown>).name;
		return typeof name === "string" && name.trim() ? name.trim() : undefined;
	} catch {
		return undefined;
	}
}

export function resolveScopeName(
	scope: ReleaseScope,
	cwd: string,
): ReleaseScope {
	return { ...scope, name: scope.name ?? readPackageName(cwd) };
}

export function filterCommitsByScope(
	commits: ReadonlyArray<Commit>,
	paths: ReadonlyArray<string>,
	repoRoot: string,
): Commit[] {
	return commits.filter((commit) => {
		const firstParent = runGit(
			["rev-parse", "--verify", `${commit.hash}^`],
			repoRoot,
		);
		const changed = firstParent
			? runGit(
					["diff", "--name-only", firstParent, commit.hash, "--", ...paths],
					repoRoot,
				)
			: runGit(
					[
						"diff-tree",
						"--no-commit-id",
						"--name-only",
						"-r",
						"--root",
						commit.hash,
						"--",
						...paths,
					],
					repoRoot,
				);
		return Boolean(changed);
	});
}
