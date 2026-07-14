import type { Commit, Release, ReleaseScope } from "../types.js";

const CONVENTIONAL_PREFIXES: Record<string, string> = {
	feat: "Features",
	fix: "Bug Fixes",
	perf: "Performance",
	docs: "Documentation",
	refactor: "Refactoring",
	chore: "Chores",
	test: "Tests",
	ci: "CI",
	build: "Build",
	style: "Style",
};

function parsePrefix(subject: string): { prefix: string | null; text: string } {
	const match = subject.match(/^(\w+)(?:\(.+?\))?!?:\s*(.+)/);
	if (match) return { prefix: match[1], text: match[2] };
	return { prefix: null, text: subject };
}

export function generateFallbackNotes(
	commits: ReadonlyArray<Commit>,
	nextRelease: Release & { type: string },
	scope?: ReleaseScope,
): string {
	if (commits.length === 0) {
		if (scope) {
			return `### Updates\n\n- ${scope.name ?? "This package"} receives dependency updates with no direct user-observable changes.`;
		}
		return `## ${nextRelease.version}\n\nNo notable changes.`;
	}

	const grouped = new Map<string, string[]>();

	for (const commit of commits) {
		const { prefix, text } = parsePrefix(commit.subject);
		const group = (prefix && CONVENTIONAL_PREFIXES[prefix]) || "Changes";
		const list = grouped.get(group) ?? [];
		list.push(text);
		grouped.set(group, list);
	}

	const lines: string[] = [];

	for (const [group, items] of grouped) {
		lines.push(`### ${group}\n`);
		for (const item of items) {
			lines.push(`- ${item}`);
		}
		lines.push("");
	}

	return lines.join("\n").trim();
}
