# semantic-release-ai-notes

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
  "model": "claude-sonnet-4-20250514",
  "brandFile": "brand.md",
  "style": "concise",
  "maxTurns": 15
}]
```

| Option | Default | Description |
|--------|---------|-------------|
| `model` | `claude-sonnet-4-20250514` | Claude model to use |
| `brandFile` | `brand.md` | Path to a voice/tone guide (optional) |
| `style` | `concise` | `"concise"` (bullet points) or `"detailed"` (short paragraphs) |
| `maxTurns` | `15` | Max agent tool-use rounds (caps cost) |

All options are optional. Zero config works.

## Voice & tone

If your project has a `brand.md` (or any voice guide), the agent reads it and matches the tone. This is optional — without it, the agent writes clean, neutral developer-facing notes.

See [brand.md](https://github.com/thebrandmd/brand.md) for the open standard.

## Requirements

- `ANTHROPIC_API_KEY` environment variable
- `semantic-release >= 20.0.0`
- `git` available in PATH (for `git diff`)

## License

MIT
