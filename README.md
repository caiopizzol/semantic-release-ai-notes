# semantic-release-ai-notes

[![npm version](https://img.shields.io/npm/v/semantic-release-ai-notes.svg)](https://www.npmjs.com/package/semantic-release-ai-notes)

AI-powered release notes for [semantic-release](https://github.com/semantic-release/semantic-release), using Claude.

Instead of reformatting commit messages, this plugin gives a Claude agent read-only access to your codebase. It explores the actual code changes, understands what was done, and writes release notes a human would write.

## Install

```bash
npm install -D semantic-release-ai-notes
```

## Usage

Replace `@semantic-release/release-notes-generator` in your config:

```json
{
  "plugins": [
    "@semantic-release/commit-analyzer",
    "semantic-release-ai-notes",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}
```

Set `ANTHROPIC_API_KEY` in your CI environment.

## How it works

1. Gets the list of commits since the last release
2. Runs `git diff --stat` to see which files changed
3. Reads the most important changed files to understand what was done
4. Reads `brand.md` (if present) to match your project's voice
5. Generates clean, grouped release notes

If the AI call fails for any reason, it falls back to basic commit-list notes. A release is never blocked.

## Configuration

```json
["semantic-release-ai-notes", {
  "model": "claude-haiku-4-5",
  "brandFile": "brand.md",
  "style": "concise",
  "maxTurns": 15,
  "scope": {
    "paths": ["packages/cli"],
    "audience": "CLI users"
  }
}]
```

| Option | Default | Description |
|--------|---------|-------------|
| `model` | `claude-haiku-4-5` | Claude model to use |
| `brandFile` | `brand.md` | Path to a voice/tone guide (optional) |
| `style` | `concise` | `"concise"` (brief bullet descriptions) or `"detailed"` (longer, multi-sentence bullet descriptions) |
| `maxTurns` | `15` | Max agent tool-use rounds (caps cost) |
| `scope` | — | Optional package-specific release-note boundary; see below |

All options are optional. Zero config works.

### Package scopes

Use `scope` when one repository publishes multiple packages or products. `paths` is required and contains literal repo-relative file or directory paths whose commits and diffs are relevant to that release. Glob patterns are not supported; list directories instead. `name` defaults to the `name` in the `package.json` at semantic-release's current working directory.

```json
["semantic-release-ai-notes", {
  "scope": {
    "name": "@acme/cli",
    "paths": ["packages/cli"],
    "audience": "CLI users",
    "instructions": "Describe command and configuration changes, not internal refactors."
  }
}]
```

Shared paths can be included when package behavior inherits changes from common code. For example, a SuperDoc-style package can include both its own directory and the shared engine it exposes:

```json
["semantic-release-ai-notes", {
  "scope": {
    "name": "@superdoc/cli",
    "paths": [
      "packages/cli",
      "packages/core",
      "packages/common"
    ],
    "audience": "SuperDoc CLI users",
    "instructions": "Prioritize document conversion and command-line behavior."
  }
}]
```

The notes distinguish direct package changes from inherited dependency or shared-code changes. Inherited changes are included only when users of that package can observe them. If a package release contains no user-observable scoped change, the result is a single concise dependency-update note.

Scope filters the evidence used to write notes by intersecting semantic-release's selected commits with `paths`. It never adds commits and never changes whether semantic-release creates a release.

`scope` is optional and backward-compatible. Existing configurations keep repository-wide release notes without migration changes.

## GitHub Action

The GitHub Action accepts the same scope concepts. Pass `scope-paths` as a newline-separated value:

```yaml
- uses: caiopizzol/semantic-release-ai-notes@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    previous-tag: cli-v1.4.0
    scope-name: '@superdoc/cli'
    scope-package-path: packages/cli
    scope-paths: |
      packages/cli
      packages/core
      packages/common
    scope-audience: 'SuperDoc CLI users'
    scope-instructions: 'Prioritize document conversion and command-line behavior.'
```

`scope-package-path` identifies the package directory for prompt context and for resolving the default scope name from its `package.json`. Scope paths and the package path are literal repo-relative files or directories, not globs.

In monorepos with multiple tag namespaces, pass `previous-tag` explicitly so the comparison starts at the prior release for that package. Without it, the Action auto-detects the nearest repository tag, which may belong to another package.

## Voice & tone

If your project has a `brand.md` (or any voice guide), the agent reads it and matches the tone. This is optional — without it, the agent writes clean, neutral developer-facing notes.

See [brand.md](https://github.com/thebrandmd/brand.md) for the open standard.

## Requirements

- `ANTHROPIC_API_KEY` environment variable
- `semantic-release >= 20.0.0`
- `git` available in PATH (for `git diff`)

## License

MIT
