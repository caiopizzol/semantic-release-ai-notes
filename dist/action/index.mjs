// action/index.ts
import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
function git(cmd) {
  return execSync(`git ${cmd}`, {
    encoding: "utf-8",
    maxBuffer: 1e7
  }).trim();
}
function getRepoRoot() {
  try {
    return git("rev-parse --show-toplevel");
  } catch {
    return process.cwd();
  }
}
function detectPreviousTag() {
  try {
    return git("describe --tags --abbrev=0 HEAD^");
  } catch {
    return "";
  }
}
function detectCurrentTag() {
  try {
    return git("describe --tags --exact-match HEAD");
  } catch {
    return git("rev-parse --short HEAD");
  }
}
function getCommitLog(from, to) {
  const range = from ? `${from}..${to}` : to;
  try {
    return git(`log --format="- %s (%h)" ${range}`);
  } catch {
    return "";
  }
}
function buildPrompt(prevTag, curTag, commitLog, brandContent, style) {
  const parts = [];
  const prev = prevTag ? `Previous release: ${prevTag}.` : "This is the first release.";
  parts.push(`Generate release notes for ${curTag}. ${prev}`);
  parts.push(`
## Commits in this release

${commitLog}`);
  if (prevTag) {
    parts.push(`
## Instructions
`, `Run \`git diff --stat ${prevTag}...${curTag}\` to see which files changed.`, "Then read the most important changed files to understand what was actually done.", "Use the commit hashes above to guide your exploration — but do not include them in the output.");
  } else {
    parts.push(`
## Instructions
`, "This is the first release. Read the project's README or main source files to understand what this project does, then summarize its initial capabilities.");
  }
  if (brandContent) {
    parts.push(`
## Voice & Tone Guide
`, `Match this tone when writing the notes:
`, brandContent);
  }
  if (style === "concise") {
    parts.push(`
## Style
`, "Keep descriptions brief — one sentence per change.");
  } else {
    parts.push(`
## Style
`, "You may use 2-3 sentences in the description for significant features. Keep smaller changes to one sentence.");
  }
  return parts.join(`
`);
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
  const repoRoot = getRepoRoot();
  const prevTag = getInput("previous_tag") || detectPreviousTag();
  const curTag = detectCurrentTag();
  console.log(`Generating AI release notes for ${curTag}${prevTag ? ` (from ${prevTag})` : ""}`);
  const commitLog = getCommitLog(prevTag, curTag);
  if (!commitLog) {
    console.log("No commits found.");
    setOutput("notes", "No notable changes.");
    return;
  }
  let brandContent = "";
  try {
    brandContent = readFileSync(resolve(repoRoot, brandFile), "utf-8");
  } catch {}
  const prompt = buildPrompt(prevTag, curTag, commitLog, brandContent, style);
  const sysFile = join(tmpdir(), `sr-ai-notes-system-${randomUUID()}.txt`);
  writeFileSync(sysFile, SYSTEM_PROMPT);
  let notes = "";
  try {
    const result = spawnSync("claude", buildClaudeArgs({ model, maxTurns, sysFile, prompt }), {
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
    notes = commitLog;
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
      execSync(`gh release edit "${curTag}" --notes-file "${notesFile}"`, {
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
  renderClaudeStructuredOutputOrFallback,
  renderClaudeStructuredOutput,
  buildClaudeArgs
};
