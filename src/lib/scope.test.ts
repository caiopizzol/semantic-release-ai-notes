import { describe, expect, test } from "bun:test";
import { validateScope } from "./scope.js";

describe("validateScope", () => {
	test("accepts and normalizes a valid scope", () => {
		expect(
			validateScope({
				name: " @superdoc/cli ",
				paths: [" packages/cli ", "packages/shared"],
				audience: " CLI users ",
				instructions: " Include command changes. ",
			}),
		).toEqual({
			name: "@superdoc/cli",
			paths: ["packages/cli", "packages/shared"],
			audience: "CLI users",
			instructions: "Include command changes.",
		});
	});

	test.each([
		["non-array", { paths: "packages/cli" }, "scope.paths"],
		["empty array", { paths: [] }, "scope.paths"],
		["empty path", { paths: [""] }, "scope.paths[0]"],
		["pathspec magic", { paths: [":(exclude)pkg"] }, "scope.paths[0]"],
		["root pathspec magic", { paths: [":/"] }, "scope.paths[0]"],
		["absolute POSIX path", { paths: ["/packages/cli"] }, "scope.paths[0]"],
		[
			"absolute Windows path",
			{ paths: ["C:\\packages\\cli"] },
			"scope.paths[0]",
		],
		["traversal", { paths: ["packages/../secret"] }, "scope.paths[0]"],
		["newline", { paths: ["packages/cli\nREADME.md"] }, "scope.paths[0]"],
		["NUL", { paths: ["packages/cli\0README.md"] }, "scope.paths[0]"],
		["empty name", { paths: ["packages/cli"], name: " " }, "scope.name"],
		[
			"empty audience",
			{ paths: ["packages/cli"], audience: "" },
			"scope.audience",
		],
		[
			"empty instructions",
			{ paths: ["packages/cli"], instructions: "\t" },
			"scope.instructions",
		],
	] as const)("rejects %s with an actionable option name", (_label, value, option) => {
		try {
			validateScope(value);
			throw new Error("Expected scope validation to fail");
		} catch (error) {
			expect(error).toHaveProperty("name", "SemanticReleaseError");
			expect((error as Error).message).toContain(option);
			expect(error).toHaveProperty("code", "EINVALIDSCOPE");
		}
	});

	test.each([
		"*",
		"?",
		"[",
		"]",
	])("rejects the %s pathspec glob metacharacter", (metacharacter) => {
		expect(() =>
			validateScope({ paths: [`packages/cli/${metacharacter}`] }),
		).toThrow(
			"must be a literal repo-relative path: glob patterns are not supported; list directories instead",
		);
	});
});
