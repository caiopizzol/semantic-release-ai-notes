import { describe, expect, test } from "bun:test";
import {
	type ReleaseNotes,
	releaseNotesSchema,
	renderNotes,
} from "../src/lib/notes-schema.js";
import {
	buildClaudeArgs,
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
