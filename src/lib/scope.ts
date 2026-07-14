import path from "node:path";
import SemanticReleaseError from "@semantic-release/error";
import type { ReleaseScope } from "../types.js";

function invalid(option: string, expectation: string): never {
	throw new SemanticReleaseError(
		`Invalid ${option}: ${expectation}.`,
		"EINVALIDSCOPE",
		`Update the semantic-release-ai-notes ${option} configuration and try again.`,
	);
}

function validateOptionalString(
	scope: Record<string, unknown>,
	key: "name" | "audience" | "instructions",
): string | undefined {
	const value = scope[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		return invalid(`scope.${key}`, "must be a non-empty string when provided");
	}
	return value.trim();
}

function validatePath(value: unknown, index: number): string {
	const option = `scope.paths[${index}]`;
	if (typeof value !== "string" || value.trim().length === 0) {
		return invalid(option, "must be a non-empty repo-relative string");
	}

	const scopedPath = value.trim();
	if (scopedPath.startsWith(":")) {
		return invalid(option, "paths must be literal repo-relative paths");
	}
	if (scopedPath.includes("\n") || scopedPath.includes("\r")) {
		return invalid(option, "must not contain newlines");
	}
	if (scopedPath.includes("\0")) {
		return invalid(option, "must not contain NUL characters");
	}
	if (path.posix.isAbsolute(scopedPath) || path.win32.isAbsolute(scopedPath)) {
		return invalid(option, "must be relative to the repository root");
	}
	if (scopedPath.split(/[\\/]/).includes("..")) {
		return invalid(option, "must not contain '..' path traversal");
	}

	return scopedPath.replaceAll("\\", "/");
}

export function validateScope(value: unknown): ReleaseScope | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return invalid("scope", "must be an object");
	}

	const scope = value as Record<string, unknown>;
	if (!Array.isArray(scope.paths)) {
		return invalid(
			"scope.paths",
			"must be a non-empty array of repo-relative paths",
		);
	}
	if (scope.paths.length === 0) {
		return invalid(
			"scope.paths",
			"must contain at least one repo-relative path",
		);
	}

	return {
		name: validateOptionalString(scope, "name"),
		paths: scope.paths.map(validatePath),
		audience: validateOptionalString(scope, "audience"),
		instructions: validateOptionalString(scope, "instructions"),
	};
}
