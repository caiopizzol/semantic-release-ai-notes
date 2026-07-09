import { describe, expect, test } from "bun:test";
import {
	type ReleaseNotes,
	renderNotes,
	validateReleaseNotes,
} from "./notes-schema.js";

const validNotes: ReleaseNotes = {
	sections: [
		{
			heading: "What's New",
			items: [
				{
					title: "Structured release notes",
					description: "Generates validated notes from schema data.",
				},
			],
		},
		{
			heading: "Fixes",
			items: [
				{
					title: "Narration filtering",
					description: "Prevents assistant narration from reaching releases.",
				},
			],
		},
	],
};

describe("renderNotes", () => {
	test("renders schema data as release notes markdown", () => {
		expect(renderNotes(validNotes)).toBe(
			[
				"### What's New",
				"",
				"- **Structured release notes** — Generates validated notes from schema data.",
				"",
				"### Fixes",
				"",
				"- **Narration filtering** — Prevents assistant narration from reaching releases.",
			].join("\n"),
		);
	});
});

describe("validateReleaseNotes", () => {
	test("accepts valid release note data", () => {
		expect(validateReleaseNotes(validNotes)).toBe(true);
	});

	test("rejects an empty sections array", () => {
		expect(validateReleaseNotes({ sections: [] })).toBe(false);
	});

	test("rejects empty items", () => {
		expect(
			validateReleaseNotes({
				sections: [{ heading: "What's New", items: [] }],
			}),
		).toBe(false);
	});

	test("rejects unknown headings", () => {
		expect(
			validateReleaseNotes({
				sections: [{ heading: "Notes", items: validNotes.sections[0].items }],
			}),
		).toBe(false);
	});

	test("rejects empty strings", () => {
		expect(
			validateReleaseNotes({
				sections: [
					{
						heading: "Fixes",
						items: [{ title: "", description: "Fixes a bug." }],
					},
				],
			}),
		).toBe(false);

		expect(
			validateReleaseNotes({
				sections: [
					{
						heading: "Fixes",
						items: [{ title: "Bug fix", description: "   " }],
					},
				],
			}),
		).toBe(false);
	});
});
