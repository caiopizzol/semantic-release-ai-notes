import { describe, expect, test } from "bun:test";
import { generateFallbackNotes } from "./fallback.js";
import type { Commit, Release } from "../types.js";

const nextRelease: Release & { type: string } = {
	version: "1.2.0",
	gitTag: "v1.2.0",
	gitHead: "abc1234",
	type: "minor",
};

function makeCommit(subject: string, body = ""): Commit {
	return { hash: "abc1234def", subject, body, message: `${subject}\n${body}` };
}

describe("generateFallbackNotes", () => {
	test("returns minimal notes for empty commits", () => {
		const result = generateFallbackNotes([], nextRelease);
		expect(result).toContain("No notable changes");
	});

	test("groups by conventional commit prefix", () => {
		const commits = [
			makeCommit("feat: add new feature"),
			makeCommit("fix: resolve bug"),
			makeCommit("feat: another feature"),
		];
		const result = generateFallbackNotes(commits, nextRelease);
		expect(result).toContain("### Features");
		expect(result).toContain("### Bug Fixes");
		expect(result).toContain("- add new feature");
		expect(result).toContain("- resolve bug");
		expect(result).toContain("- another feature");
	});

	test("handles commits without conventional format", () => {
		const commits = [makeCommit("some random change")];
		const result = generateFallbackNotes(commits, nextRelease);
		expect(result).toContain("### Changes");
		expect(result).toContain("- some random change");
	});

	test("strips scope from conventional commits", () => {
		const commits = [makeCommit("feat(ui): add button")];
		const result = generateFallbackNotes(commits, nextRelease);
		expect(result).toContain("- add button");
	});

	test("handles mixed conventional and non-conventional", () => {
		const commits = [
			makeCommit("feat: typed feature"),
			makeCommit("untyped change"),
		];
		const result = generateFallbackNotes(commits, nextRelease);
		expect(result).toContain("### Features");
		expect(result).toContain("### Changes");
	});
});
