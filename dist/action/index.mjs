// action/index.ts
import { execFileSync, spawnSync as spawnSync2 } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// src/lib/fallback.ts
var CONVENTIONAL_PREFIXES = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  docs: "Documentation",
  refactor: "Refactoring",
  chore: "Chores",
  test: "Tests",
  ci: "CI",
  build: "Build",
  style: "Style"
};
function parsePrefix(subject) {
  const match = subject.match(/^(\w+)(?:\(.+?\))?!?:\s*(.+)/);
  if (match)
    return { prefix: match[1], text: match[2] };
  return { prefix: null, text: subject };
}
function generateFallbackNotes(commits, nextRelease, scope) {
  if (commits.length === 0) {
    if (scope) {
      return `### Updates

- ${scope.name ?? "This package"} receives dependency updates with no direct user-observable changes.`;
    }
    return `## ${nextRelease.version}

No notable changes.`;
  }
  const grouped = new Map;
  for (const commit of commits) {
    const { prefix, text } = parsePrefix(commit.subject);
    const group = prefix && CONVENTIONAL_PREFIXES[prefix] || "Changes";
    const list = grouped.get(group) ?? [];
    list.push(text);
    grouped.set(group, list);
  }
  const lines = [];
  for (const [group, items] of grouped) {
    lines.push(`### ${group}
`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  return lines.join(`
`).trim();
}

// src/lib/git.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 1e7
  });
  if (result.status !== 0 || result.error)
    return null;
  return result.stdout.trim();
}
function getRepoRoot(cwd) {
  return runGit(["rev-parse", "--show-toplevel"], cwd) || cwd;
}
function getPackagePath(repoRoot, cwd) {
  const relative = path.relative(repoRoot, cwd);
  return relative ? relative.split(path.sep).join("/") : ".";
}
function readPackageName(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    const name = parsed.name;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return;
  }
}
function resolveScopeName(scope, cwd) {
  return { ...scope, name: scope.name ?? readPackageName(cwd) };
}
function filterCommitsByScope(commits, paths, repoRoot) {
  return commits.filter((commit) => {
    const firstParent = runGit(["rev-parse", "--verify", `${commit.hash}^`], repoRoot);
    const changed = firstParent ? runGit(["diff", "--name-only", firstParent, commit.hash, "--", ...paths], repoRoot) : runGit([
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--root",
      commit.hash,
      "--",
      ...paths
    ], repoRoot);
    return Boolean(changed);
  });
}

// src/lib/notes-schema.ts
var RELEASE_NOTE_HEADINGS = [
  "What's New",
  "Improvements",
  "Fixes",
  "Breaking Changes"
];
var releaseNotesSchema = {
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
            enum: RELEASE_NOTE_HEADINGS
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
                description: { type: "string", minLength: 1 }
              }
            }
          }
        }
      }
    }
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isReleaseNoteHeading(value) {
  return typeof value === "string" && RELEASE_NOTE_HEADINGS.includes(value);
}
function isReleaseNoteItem(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["title", "description"])) {
    return false;
  }
  return isNonEmptyString(value.title) && isNonEmptyString(value.description);
}
function isReleaseNoteSection(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["heading", "items"])) {
    return false;
  }
  return isReleaseNoteHeading(value.heading) && Array.isArray(value.items) && value.items.length > 0 && value.items.every(isReleaseNoteItem);
}
function normalizeNoteText(value) {
  return value.trim().replace(/\s+/g, " ");
}
function validateReleaseNotes(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["sections"])) {
    return false;
  }
  return Array.isArray(value.sections) && value.sections.length > 0 && value.sections.every(isReleaseNoteSection);
}
function renderNotes(notes) {
  return notes.sections.map((section) => {
    const items = section.items.map((item) => `- **${normalizeNoteText(item.title)}** — ${normalizeNoteText(item.description)}`).join(`
`);
    return `### ${section.heading}

${items}`;
  }).join(`

`).trim();
}

// src/lib/prompt.ts
var SYSTEM_PROMPT = `You are a release notes writer. You generate clean, reader-friendly release-note data for software projects.

You have access to the codebase via tools. Use them to understand what actually changed — don't just rephrase commit messages.

Output requirements:
- Output ONLY structured data matching the configured JSON schema. No preamble, no explanation, no wrapping code fences.
- The root object has a sections array with at least one section.
- Each section heading must be one of: ${RELEASE_NOTE_HEADINGS.join(", ")}.
- Each section has at least one item with a non-empty title and non-empty description.

Content rules:
- Focus on what matters to users of this software.
- Group changes by theme using the schema headings as appropriate.
- Use item titles for feature or change names.
- Use item descriptions for the user-facing explanation.
- Write in present tense, active voice.
- Be specific about what changed, not vague.
- Do NOT include the version number as a heading or item title.
- Do NOT include commit hashes or links.
- If a voice/tone guide is provided, match its tone and style.
- Skip trivial changes (version bumps, CI config tweaks) unless they're the only changes.`;
function shellArgument(value) {
  if (/^[A-Za-z0-9_./@+-]+$/.test(value))
    return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
function buildScopeGuidance({
  scope,
  packagePath
}) {
  const packageName = scope.name ?? "this package";
  const audience = scope.audience ?? `users of ${packageName}`;
  const guidance = [
    `These release notes are specifically for ${packageName}, located at \`${packagePath}\`.`,
    `Write for ${audience}.`,
    "Distinguish direct changes to this package from inherited changes in shared code or dependencies.",
    "Include inherited changes only when they are observable by users of this package.",
    "If nothing user-observable changed, emit a single concise dependency-update note instead of general repository changes."
  ];
  if (scope.instructions) {
    guidance.push(`Additional scope instructions: ${scope.instructions}`);
  }
  return guidance;
}
function buildPrompt({
  commits,
  lastRelease,
  nextRelease,
  brandContent,
  style = "concise",
  scope,
  packagePath = "."
}) {
  const parts = [];
  const previousRelease = nextRelease.type ? `v${lastRelease.version}` : lastRelease.gitTag || lastRelease.version;
  const prev = lastRelease.version || lastRelease.gitTag ? `Previous release: ${previousRelease}.` : "This is the first release.";
  const releaseDescription = nextRelease.type ? `v${nextRelease.version} (${nextRelease.type} release)` : nextRelease.gitTag || nextRelease.version;
  parts.push(`Generate release notes for ${releaseDescription}. ${prev}`);
  parts.push(`
## Commits in this release
`);
  for (const commit of commits) {
    if (typeof commit === "string") {
      parts.push(commit);
      continue;
    }
    let line = `- ${commit.subject} (${commit.hash.slice(0, 7)})`;
    if (commit.body?.trim()) {
      line += `
  ${commit.body.trim()}`;
    }
    parts.push(line);
  }
  if (lastRelease.gitHead) {
    const diffPaths = scope ? ` -- ${scope.paths.map(shellArgument).join(" ")}` : "";
    parts.push(`
## Instructions
`, `Run \`git diff --stat ${lastRelease.gitHead}...${nextRelease.gitHead}${diffPaths}\` to see which files changed.`, `Then read the most important changed files to understand what was actually done.`, `Use the commit hashes above to guide your exploration — but do not include them in the output.`);
  } else {
    parts.push(`
## Instructions
`, `This is the first release. Read the project's README or main source files to understand what this project does, then summarize its initial capabilities.`);
  }
  if (scope) {
    parts.push(`
## Release Scope
`, ...buildScopeGuidance({ scope, packagePath }));
  }
  if (brandContent) {
    parts.push(`
## Voice & Tone Guide
`, `The following is the project's brand and voice guide. Match this tone when writing the notes:
`, brandContent);
  }
  if (style === "concise") {
    parts.push(`
## Style
`, `Keep descriptions brief — one sentence per change.`);
  } else {
    parts.push(`
## Style
`, `You may use 2-3 sentences in the description for significant features. Keep smaller changes to one sentence.`);
  }
  return parts.join(`
`);
}

// src/lib/scope.ts
import path2 from "node:path";

// node_modules/.pnpm/@semantic-release+error@4.0.0/node_modules/@semantic-release/error/index.js
class SemanticReleaseError extends Error {
  constructor(message, code, details) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
    this.name = "SemanticReleaseError";
    this.code = code;
    this.details = details;
    this.semanticRelease = true;
  }
}

// src/lib/scope.ts
function invalid(option, expectation) {
  throw new SemanticReleaseError(`Invalid ${option}: ${expectation}.`, "EINVALIDSCOPE", `Update the semantic-release-ai-notes ${option} configuration and try again.`);
}
function validateOptionalString(scope, key) {
  const value = scope[key];
  if (value === undefined)
    return;
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid(`scope.${key}`, "must be a non-empty string when provided");
  }
  return value.trim();
}
function validatePath(value, index) {
  const option = `scope.paths[${index}]`;
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid(option, "must be a non-empty repo-relative string");
  }
  const scopedPath = value.trim();
  if (scopedPath.startsWith(":")) {
    return invalid(option, "must be a literal repo-relative path");
  }
  if (["*", "?", "[", "]"].some((character) => scopedPath.includes(character))) {
    return invalid(option, "must be a literal repo-relative path: glob patterns are not supported; list directories instead");
  }
  if (scopedPath.includes(`
`) || scopedPath.includes("\r")) {
    return invalid(option, "must not contain newlines");
  }
  if (scopedPath.includes("\x00")) {
    return invalid(option, "must not contain NUL characters");
  }
  if (path2.posix.isAbsolute(scopedPath) || path2.win32.isAbsolute(scopedPath)) {
    return invalid(option, "must be relative to the repository root");
  }
  if (scopedPath.split(/[\\/]/).includes("..")) {
    return invalid(option, "must not contain '..' path traversal");
  }
  return scopedPath.replaceAll("\\", "/");
}
function validateScope(value) {
  if (value === undefined)
    return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid("scope", "must be an object");
  }
  const scope = value;
  if (!Array.isArray(scope.paths)) {
    return invalid("scope.paths", "must be a non-empty array of repo-relative paths");
  }
  if (scope.paths.length === 0) {
    return invalid("scope.paths", "must contain at least one repo-relative path");
  }
  return {
    name: validateOptionalString(scope, "name"),
    paths: scope.paths.map(validatePath),
    audience: validateOptionalString(scope, "audience"),
    instructions: validateOptionalString(scope, "instructions")
  };
}

// action/index.ts
function getInput(name, fallback = "") {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`]?.trim() || fallback;
}
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    const delim = `delim_${randomUUID()}`;
    appendFileSync(file, `${name}<<${delim}
${value}
${delim}
`);
  }
}
function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 1e7
  }).trim();
}
function detectPreviousTag() {
  try {
    return git(["describe", "--tags", "--abbrev=0", "HEAD^"]);
  } catch {
    return "";
  }
}
function detectCurrentTag() {
  try {
    return git(["describe", "--tags", "--exact-match", "HEAD"]);
  } catch {
    return git(["rev-parse", "--short", "HEAD"]);
  }
}
function getCommits(from, to, repoRoot) {
  const range = from ? `${from}..${to}` : to;
  try {
    const log = git(["log", "--format=%H%x1f%s", range], repoRoot);
    if (!log)
      return [];
    return log.split(`
`).map((line) => {
      const [hash = "", subject = ""] = line.split("\x1F", 2);
      return { hash, subject, body: "", message: subject };
    });
  } catch {
    return [];
  }
}
function formatCommitLog(commits) {
  return commits.map((commit) => `- ${commit.subject} (${commit.hash.slice(0, 7)})`).join(`
`);
}
function parseScopePaths(value) {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}
function parseActionScope({
  name,
  paths,
  audience,
  instructions
}) {
  if (!name && !paths && !audience && !instructions)
    return;
  return validateScope({
    name: name || undefined,
    paths: parseScopePaths(paths),
    audience: audience || undefined,
    instructions: instructions || undefined
  });
}
function parseScopePackagePath(value) {
  if (!value)
    return;
  try {
    return validateScope({ paths: [value] })?.paths[0];
  } catch (error) {
    throw new Error(error.message.replace(/scope\.paths\[0\]/g, "scope-package-path"));
  }
}
function assertFullHistory(repoRoot) {
  let shallow;
  try {
    shallow = git(["rev-parse", "--is-shallow-repository"], repoRoot);
  } catch {
    return;
  }
  if (shallow === "true") {
    throw new Error("Scoped release notes require full git history, but this repository is a shallow clone. Use actions/checkout with `fetch-depth: 0`.");
  }
}
function resolveActionScopeContext({
  scope,
  scopePackagePath,
  repoRoot,
  cwd
}) {
  if (!scope)
    return {};
  const packagePath = scopePackagePath ?? getPackagePath(repoRoot, cwd);
  const packageDirectory = scopePackagePath ? resolve(repoRoot, scopePackagePath) : cwd;
  return {
    scope: resolveScopeName(scope, packageDirectory),
    packagePath
  };
}
function buildActionPrompt({
  prevTag,
  curTag,
  commitLog,
  brandContent,
  style,
  scope,
  packagePath
}) {
  return buildPrompt({
    commits: commitLog ? commitLog.split(`
`) : [],
    lastRelease: {
      version: prevTag,
      gitTag: prevTag,
      gitHead: prevTag
    },
    nextRelease: {
      version: curTag,
      gitTag: curTag,
      gitHead: curTag
    },
    brandContent,
    style,
    scope,
    packagePath
  });
}
function buildClaudeArgs({
  model,
  maxTurns,
  sysFile,
  prompt
}) {
  return [
    "-p",
    "--bare",
    "--json-schema",
    JSON.stringify(releaseNotesSchema),
    "--model",
    model,
    "--max-turns",
    maxTurns,
    "--allowedTools",
    "Read,Glob,Grep,Bash",
    "--disallowedTools",
    "Write,Edit,NotebookEdit",
    "--append-system-prompt-file",
    sysFile,
    "--dangerously-skip-permissions",
    prompt
  ];
}
function renderClaudeStructuredOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed)
    throw new Error("Empty response from Claude");
  const parsed = JSON.parse(trimmed);
  if (!validateReleaseNotes(parsed)) {
    throw new Error("Claude returned invalid structured release notes");
  }
  return renderNotes(parsed);
}
function renderClaudeStructuredOutputOrFallback(stdout, commitLog) {
  try {
    return renderClaudeStructuredOutput(stdout);
  } catch {
    return commitLog;
  }
}
async function main() {
  const model = getInput("model", "claude-haiku-4-5");
  const style = getInput("style", "concise");
  const maxTurns = getInput("max_turns", "15");
  const brandFile = getInput("brand_file", "brand.md");
  const updateRelease = getInput("update_release") === "true";
  const configuredScope = parseActionScope({
    name: getInput("scope_name"),
    paths: getInput("scope_paths"),
    audience: getInput("scope_audience"),
    instructions: getInput("scope_instructions")
  });
  const scopePackagePath = parseScopePackagePath(getInput("scope_package_path"));
  const cwd = process.cwd();
  const repoRoot = getRepoRoot(cwd);
  if (configuredScope)
    assertFullHistory(repoRoot);
  const { scope, packagePath } = resolveActionScopeContext({
    scope: configuredScope,
    scopePackagePath,
    repoRoot,
    cwd
  });
  const prevTag = getInput("previous_tag") || detectPreviousTag();
  const curTag = detectCurrentTag();
  console.log(`Generating AI release notes for ${curTag}${prevTag ? ` (from ${prevTag})` : ""}`);
  const releaseCommits = getCommits(prevTag, curTag, repoRoot);
  const commits = scope ? filterCommitsByScope(releaseCommits, scope.paths, repoRoot) : releaseCommits;
  const commitLog = formatCommitLog(commits);
  if (!commitLog && !scope) {
    console.log("No commits found.");
    setOutput("notes", "No notable changes.");
    return;
  }
  let brandContent = "";
  try {
    brandContent = readFileSync(resolve(repoRoot, brandFile), "utf-8");
  } catch {}
  const nextRelease = {
    version: curTag,
    gitTag: curTag,
    gitHead: curTag,
    type: ""
  };
  const prompt = buildActionPrompt({
    prevTag,
    curTag,
    commitLog,
    brandContent,
    style: style === "detailed" ? "detailed" : "concise",
    scope,
    packagePath
  });
  const sysFile = join(tmpdir(), `sr-ai-notes-system-${randomUUID()}.txt`);
  writeFileSync(sysFile, SYSTEM_PROMPT);
  let notes = "";
  try {
    const result = spawnSync2("claude", buildClaudeArgs({ model, maxTurns, sysFile, prompt }), {
      encoding: "utf-8",
      cwd: repoRoot,
      timeout: 300000,
      maxBuffer: 1e7
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `Exit code ${result.status}`);
    }
    notes = renderClaudeStructuredOutput(result.stdout);
    console.log("AI release notes generated successfully.");
  } catch (err) {
    console.log(`::warning::AI generation failed: ${err.message}`);
    console.log("Falling back to commit-list notes.");
    notes = scope ? generateFallbackNotes(commits, nextRelease, scope) : commitLog;
  }
  setOutput("notes", notes);
  if (updateRelease) {
    const ghToken = process.env.GH_TOKEN;
    if (!ghToken) {
      console.log("::warning::update-release is true but no github-token provided.");
      return;
    }
    try {
      const notesFile = join(tmpdir(), `sr-ai-notes-${randomUUID()}.md`);
      writeFileSync(notesFile, notes);
      execFileSync("gh", ["release", "edit", curTag, "--notes-file", notesFile], {
        encoding: "utf-8",
        env: { ...process.env, GH_TOKEN: ghToken }
      });
      console.log(`Updated GitHub release ${curTag}.`);
    } catch (err) {
      console.log(`::warning::Failed to update release: ${err.message}`);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
export {
  resolveActionScopeContext,
  renderClaudeStructuredOutputOrFallback,
  renderClaudeStructuredOutput,
  parseScopePaths,
  parseScopePackagePath,
  parseActionScope,
  buildClaudeArgs,
  buildActionPrompt,
  assertFullHistory
};
