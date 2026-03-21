import { describe, expect, test } from "bun:test";
import type { Commit, PluginConfig, Release } from "../types.js";
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

const defaultConfig: PluginConfig = {};

describe("SYSTEM_PROMPT", () => {
	test("instructs no preamble", () => {
		expect(SYSTEM_PROMPT).toContain("No preamble");
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
		const result = buildPrompt(
			commits,
			lastRelease,
			nextRelease,
			null,
			defaultConfig,
		);
		expect(result).toContain("v1.1.0");
		expect(result).toContain("minor release");
		expect(result).toContain("v1.0.0");
	});

	test("includes commit subjects", () => {
		const result = buildPrompt(
			commits,
			lastRelease,
			nextRelease,
			null,
			defaultConfig,
		);
		expect(result).toContain("feat: add new feature");
		expect(result).toContain("fix: resolve bug");
	});

	test("includes commit body when present", () => {
		const result = buildPrompt(
			commits,
			lastRelease,
			nextRelease,
			null,
			defaultConfig,
		);
		expect(result).toContain("Detailed description");
	});

	test("includes git diff instruction", () => {
		const result = buildPrompt(
			commits,
			lastRelease,
			nextRelease,
			null,
			defaultConfig,
		);
		expect(result).toContain("git diff --stat aaa1111...bbb2222");
	});

	test("includes brand content when provided", () => {
		const brand = "Be concise. Speak developer-to-developer.";
		const result = buildPrompt(
			commits,
			lastRelease,
			nextRelease,
			brand,
			defaultConfig,
		);
		expect(result).toContain("Voice & Tone Guide");
		expect(result).toContain(brand);
	});

	test("omits brand section when null", () => {
		const result = buildPrompt(
			commits,
			lastRelease,
			nextRelease,
			null,
			defaultConfig,
		);
		expect(result).not.toContain("Voice & Tone Guide");
	});

	test("applies concise style by default", () => {
		const result = buildPrompt(
			commits,
			lastRelease,
			nextRelease,
			null,
			defaultConfig,
		);
		expect(result).toContain("one sentence per change");
	});

	test("applies detailed style", () => {
		const result = buildPrompt(commits, lastRelease, nextRelease, null, {
			style: "detailed",
		});
		expect(result).toContain("short paragraph");
	});

	test("handles first release (no lastRelease version)", () => {
		const first: Release = { version: "", gitTag: "", gitHead: "" };
		const result = buildPrompt(
			commits,
			first,
			nextRelease,
			null,
			defaultConfig,
		);
		expect(result).toContain("first release");
	});
});
