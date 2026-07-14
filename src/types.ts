export interface ReleaseScope {
	/** Published package or product name (defaults to package.json at cwd) */
	name?: string;
	/** Repository-relative paths relevant to this release */
	paths: string[];
	/** Intended reader for these release notes */
	audience?: string;
	/** Additional relevance rules appended to the maintained prompt */
	instructions?: string;
}

export interface PluginConfig {
	/** Claude model to use (default: "claude-haiku-4-5") */
	model?: string;
	/** Path to a voice/tone file relative to cwd, e.g. brand.md (default: "brand.md") */
	brandFile?: string;
	/** Notes style: "concise" (one line per change) or "detailed" (longer, multi-sentence descriptions) */
	style?: "concise" | "detailed";
	/** Maximum agent turns to prevent runaway cost (default: 15) */
	maxTurns?: number;
	/** Optional package-specific release-note boundary for monorepos */
	scope?: ReleaseScope;
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
