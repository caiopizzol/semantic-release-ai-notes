export interface PluginConfig {
	/** Claude model to use (default: "claude-haiku-4-5") */
	model?: string;
	/** Path to a voice/tone file relative to cwd, e.g. brand.md (default: "brand.md") */
	brandFile?: string;
	/** Notes style: "concise" (one line per change) or "detailed" (short paragraphs) */
	style?: "concise" | "detailed";
	/** Maximum agent turns to prevent runaway cost (default: 15) */
	maxTurns?: number;
}

// Minimal types for semantic-release context — only what we use

export interface Commit {
	hash: string;
	subject: string;
	body: string;
	message: string;
}

export interface Release {
	version: string;
	gitTag: string;
	gitHead: string;
}

export interface VerifyConditionsContext {
	logger: Logger;
	env: Record<string, string | undefined>;
}

export interface GenerateNotesContext {
	cwd: string;
	logger: Logger;
	commits: Commit[];
	lastRelease: Release;
	nextRelease: Release & { type: string };
}

export interface Logger {
	log: (message: string, ...args: unknown[]) => void;
	warn: (message: string, ...args: unknown[]) => void;
	error: (message: string, ...args: unknown[]) => void;
}
