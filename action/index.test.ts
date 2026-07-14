import { describe, expect, test } from "bun:test";
import {
	type ReleaseNotes,
	releaseNotesSchema,
	renderNotes,
} from "../src/lib/notes-schema.js";
import { buildPrompt, buildScopeGuidance } from "../src/lib/prompt.js";
import {
	buildActionPrompt,
	buildClaudeArgs,
	parseActionScope,
	parseScopePaths,
	renderClaudeStructuredOutput,
	renderClaudeStructuredOutputOrFallback,
} from "./index.ts";

const structuredNotes: ReleaseNotes = {
	sections: [
		{
			heading: "Improvements",
			items: [
				{
					title: "Structured output",
					description: "Renders release notes from validated JSON.",
				},
			],
		},
	],
};

describe("buildClaudeArgs", () => {
	test("keeps bare mode and passes the release notes JSON schema", () => {
		const args = buildClaudeArgs({
			model: "claude-haiku-4-5",
			maxTurns: "15",
			sysFile: "/tmp/system.txt",
			prompt: "Generate notes",
		});

		expect(args).toContain("--bare");

		const schemaIndex = args.indexOf("--json-schema");
		expect(schemaIndex).toBeGreaterThan(-1);

		const schemaArg = args[schemaIndex + 1];
		if (!schemaArg) throw new Error("Missing --json-schema value");
		expect(JSON.parse(schemaArg)).toEqual(releaseNotesSchema);
	});
});

describe("Action scope inputs", () => {
	test("splits newline-separated scope paths", () => {
		expect(
			parseScopePaths("packages/cli\n packages/core \r\n\nREADME.md"),
		).toEqual(["packages/cli", "packages/core", "README.md"]);
	});

	test("uses the shared scoped guidance block", () => {
		const scope = parseActionScope({
			name: "@superdoc/cli",
			paths: "packages/cli\npackages/core",
			audience: "CLI users",
			instructions: "Ignore internal benchmarks.",
		});
		if (!scope) throw new Error("Expected a parsed scope");
		const guidance = buildScopeGuidance({
			scope,
			packagePath: "packages/cli",
		}).join("\n");
		const actionPrompt = buildActionPrompt({
			prevTag: "cli-v1.0.0",
			curTag: "cli-v1.1.0",
			commitLog: "- feat(cli): add command (abc1234)",
			brandContent: "",
			style: "concise",
			scope,
			packagePath: "packages/cli",
		});
		const pluginPrompt = buildPrompt({
			commits: [],
			lastRelease: {
				version: "1.0.0",
				gitTag: "cli-v1.0.0",
				gitHead: "aaa1111",
			},
			nextRelease: {
				version: "1.1.0",
				gitTag: "cli-v1.1.0",
				gitHead: "bbb2222",
				type: "minor",
			},
			brandContent: null,
			scope,
			packagePath: "packages/cli",
		});

		expect(actionPrompt).toContain(guidance);
		expect(pluginPrompt).toContain(guidance);
		expect(actionPrompt).toContain(
			"git diff --stat cli-v1.0.0...cli-v1.1.0 -- packages/cli packages/core",
		);
	});
});

describe("renderClaudeStructuredOutput", () => {
	test("parses, validates, and renders Claude JSON stdout", () => {
		expect(renderClaudeStructuredOutput(JSON.stringify(structuredNotes))).toBe(
			renderNotes(structuredNotes),
		);
	});

	test("rejects invalid JSON stdout", () => {
		expect(() => renderClaudeStructuredOutput("not json")).toThrow();
	});

	test("rejects invalid structured release notes", () => {
		expect(() =>
			renderClaudeStructuredOutput(JSON.stringify({ sections: [] })),
		).toThrow("invalid structured release notes");
	});
});

describe("renderClaudeStructuredOutputOrFallback", () => {
	test("falls back to the commit log on parse failure", () => {
		const commitLog = "- feat: add structured notes (abc1234)";

		expect(renderClaudeStructuredOutputOrFallback("not json", commitLog)).toBe(
			commitLog,
		);
	});

	test("falls back to the commit log on validation failure", () => {
		const commitLog = "- fix: keep release notes clean (def5678)";

		expect(
			renderClaudeStructuredOutputOrFallback(
				JSON.stringify({ sections: [{ heading: "Notes", items: [] }] }),
				commitLog,
			),
		).toBe(commitLog);
	});
});
