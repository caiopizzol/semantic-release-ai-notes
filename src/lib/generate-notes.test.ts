import { describe, expect, mock, test } from "bun:test";
import type { GenerateNotesContext, PluginConfig } from "../types.js";

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

describe("generateNotes", () => {
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
});
