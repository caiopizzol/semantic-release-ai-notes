export const RELEASE_NOTE_HEADINGS = [
	"What's New",
	"Improvements",
	"Fixes",
	"Breaking Changes",
] as const;

export type ReleaseNoteHeading = (typeof RELEASE_NOTE_HEADINGS)[number];

export interface ReleaseNoteItem {
	title: string;
	description: string;
}

export interface ReleaseNoteSection {
	heading: ReleaseNoteHeading;
	items: ReleaseNoteItem[];
}

export interface ReleaseNotes {
	sections: ReleaseNoteSection[];
}

export const releaseNotesSchema: Record<string, unknown> = {
	type: "object",
	additionalProperties: false,
	required: ["sections"],
	properties: {
		sections: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["heading", "items"],
				properties: {
					heading: {
						type: "string",
						enum: RELEASE_NOTE_HEADINGS,
					},
					items: {
						type: "array",
						minItems: 1,
						items: {
							type: "object",
							additionalProperties: false,
							required: ["title", "description"],
							properties: {
								title: { type: "string", minLength: 1 },
								description: { type: "string", minLength: 1 },
							},
						},
					},
				},
			},
		},
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	keys: ReadonlyArray<string>,
): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isReleaseNoteHeading(value: unknown): value is ReleaseNoteHeading {
	return (
		typeof value === "string" &&
		(RELEASE_NOTE_HEADINGS as ReadonlyArray<string>).includes(value)
	);
}

function isReleaseNoteItem(value: unknown): value is ReleaseNoteItem {
	if (!isRecord(value) || !hasOnlyKeys(value, ["title", "description"])) {
		return false;
	}

	return isNonEmptyString(value.title) && isNonEmptyString(value.description);
}

function isReleaseNoteSection(value: unknown): value is ReleaseNoteSection {
	if (!isRecord(value) || !hasOnlyKeys(value, ["heading", "items"])) {
		return false;
	}

	return (
		isReleaseNoteHeading(value.heading) &&
		Array.isArray(value.items) &&
		value.items.length > 0 &&
		value.items.every(isReleaseNoteItem)
	);
}

export function validateReleaseNotes(value: unknown): value is ReleaseNotes {
	if (!isRecord(value) || !hasOnlyKeys(value, ["sections"])) {
		return false;
	}

	return (
		Array.isArray(value.sections) &&
		value.sections.length > 0 &&
		value.sections.every(isReleaseNoteSection)
	);
}

export function renderNotes(notes: ReleaseNotes): string {
	return notes.sections
		.map((section) => {
			const items = section.items
				.map(
					(item) => `- **${item.title.trim()}** — ${item.description.trim()}`,
				)
				.join("\n");

			return `### ${section.heading}\n\n${items}`;
		})
		.join("\n\n")
		.trim();
}
