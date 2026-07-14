import { describe, expect, test } from "bun:test";
import type { Commit, Release } from "../types.js";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt.js";

const lastRelease: Release = {
	version: "1.0.0",
	gitTag: "v1.0.0",
	gitHead: "aaa1111",
};

const nextRelease: Release & { type: string } = {
	version: "1.1.0",
	gitTag: "v1.1.0",
	gitHead: "bbb2222",
	type: "minor",
};

const commits: Commit[] = [
	{
		hash: "abc1234def",
		subject: "feat: add new feature",
		body: "Detailed description",
		message: "feat: add new feature\nDetailed description",
	},
	{
		hash: "def5678abc",
		subject: "fix: resolve bug",
		body: "",
		message: "fix: resolve bug",
	},
];

function prompt(
	overrides: Partial<Parameters<typeof buildPrompt>[0]> = {},
): string {
	return buildPrompt({
		commits,
		lastRelease,
		nextRelease,
		brandContent: null,
		...overrides,
	});
}

describe("SYSTEM_PROMPT", () => {
	test("instructs no preamble", () => {
		expect(SYSTEM_PROMPT).toContain("No preamble");
	});

	test("instructs structured data output", () => {
		expect(SYSTEM_PROMPT).toContain("structured data");
		expect(SYSTEM_PROMPT).toContain("configured JSON schema");
	});

	test("instructs no version heading", () => {
		expect(SYSTEM_PROMPT).toContain("Do NOT include the version number");
	});

	test("instructs no commit hashes", () => {
		expect(SYSTEM_PROMPT).toContain("Do NOT include commit hashes");
	});
});

describe("buildPrompt", () => {
	test("includes version info", () => {
		const result = prompt();
		expect(result).toContain("v1.1.0");
		expect(result).toContain("minor release");
		expect(result).toContain("v1.0.0");
	});

	test("includes commit subjects", () => {
		const result = prompt();
		expect(result).toContain("feat: add new feature");
		expect(result).toContain("fix: resolve bug");
	});

	test("includes commit body when present", () => {
		const result = prompt();
		expect(result).toContain("Detailed description");
	});

	test("includes git diff instruction", () => {
		const result = prompt();
		expect(result).toContain("git diff --stat aaa1111...bbb2222");
	});

	test("includes brand content when provided", () => {
		const brand = "Be concise. Speak developer-to-developer.";
		const result = prompt({ brandContent: brand });
		expect(result).toContain("Voice & Tone Guide");
		expect(result).toContain(brand);
	});

	test("omits brand section when null", () => {
		const result = prompt();
		expect(result).not.toContain("Voice & Tone Guide");
	});

	test("applies concise style by default", () => {
		const result = prompt();
		expect(result).toContain("one sentence per change");
	});

	test("applies detailed style", () => {
		const result = prompt({ style: "detailed" });
		expect(result).toContain("2-3 sentences");
	});

	test("handles first release (no lastRelease version)", () => {
		const first: Release = { version: "", gitTag: "", gitHead: "" };
		const result = prompt({ lastRelease: first });
		expect(result).toContain("first release");
	});

	test("keeps the unscoped prompt byte-identical", () => {
		expect(
			prompt(),
		).toBe(`Generate release notes for v1.1.0 (minor release). Previous release: v1.0.0.

## Commits in this release

- feat: add new feature (abc1234)
  Detailed description
- fix: resolve bug (def5678)

## Instructions

Run \`git diff --stat aaa1111...bbb2222\` to see which files changed.
Then read the most important changed files to understand what was actually done.
Use the commit hashes above to guide your exploration — but do not include them in the output.

## Style

Keep descriptions brief — one sentence per change.`);
	});

	test("adds package-specific scoped guidance", () => {
		const result = prompt({
			scope: {
				name: "@superdoc/cli",
				paths: ["packages/cli", "packages/core"],
				audience: "CLI users",
				instructions: "Ignore internal benchmark changes.",
			},
			packagePath: "packages/cli",
		});

		expect(result).toContain("@superdoc/cli");
		expect(result).toContain("`packages/cli`");
		expect(result).toContain("Write for CLI users.");
		expect(result).toContain(
			"git diff --stat aaa1111...bbb2222 -- packages/cli packages/core",
		);
		expect(result).toContain("direct changes");
		expect(result).toContain("inherited changes");
		expect(result).toContain("only when they are observable");
		expect(result).toContain("single concise dependency-update note");
		expect(result).toContain("Ignore internal benchmark changes.");
	});
});
