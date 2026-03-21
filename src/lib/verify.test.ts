import { describe, expect, test } from "bun:test";
import { verifyConditions } from "./verify.js";
import type { PluginConfig, VerifyConditionsContext } from "../types.js";

function makeContext(
	env: Record<string, string | undefined> = {},
): VerifyConditionsContext {
	return {
		logger: {
			log: () => {},
			warn: () => {},
			error: () => {},
		},
		env,
	};
}

describe("verifyConditions", () => {
	test("throws when ANTHROPIC_API_KEY is missing", async () => {
		const original = process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;

		try {
			await expect(
				verifyConditions({}, makeContext({})),
			).rejects.toThrow("ANTHROPIC_API_KEY");
		} finally {
			if (original) process.env.ANTHROPIC_API_KEY = original;
		}
	});

	test("succeeds when ANTHROPIC_API_KEY is set in context env", async () => {
		const original = process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;

		try {
			await expect(
				verifyConditions({}, makeContext({ ANTHROPIC_API_KEY: "sk-test" })),
			).resolves.toBeUndefined();
		} finally {
			if (original) process.env.ANTHROPIC_API_KEY = original;
		}
	});

	test("succeeds when ANTHROPIC_API_KEY is in process.env", async () => {
		const original = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = "sk-test";

		try {
			await expect(
				verifyConditions({}, makeContext({})),
			).resolves.toBeUndefined();
		} finally {
			if (original) process.env.ANTHROPIC_API_KEY = original;
			else delete process.env.ANTHROPIC_API_KEY;
		}
	});

	test("throws on invalid model config", async () => {
		await expect(
			verifyConditions(
				{ model: 123 as unknown as string },
				makeContext({ ANTHROPIC_API_KEY: "sk-test" }),
			),
		).rejects.toThrow("model");
	});
});
