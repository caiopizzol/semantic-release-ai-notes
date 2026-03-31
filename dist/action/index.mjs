// action/index.ts
import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// src/lib/prompt.ts
var SYSTEM_PROMPT = `You are a release notes writer. You generate clean, reader-friendly release notes for software projects.

You have access to the codebase via tools. Use them to understand what actually changed — don't just rephrase commit messages.

Rules:
- Output ONLY the release notes markdown. No preamble, no explanation, no wrapping code fences.
- Focus on what matters to users of this software.
- Group changes by theme (What's New, Fixes, Improvements, Breaking Changes) as appropriate. Use ### headings.
- Use bold for feature names, em dash for descriptions.
- Write in present tense, active voice.
- Be specific about what changed, not vague.
- Do NOT include the version number as a heading — semantic-release adds that.
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
`, "Keep notes brief — one sentence per change, no paragraphs. Bullet points only.");
  } else {
    parts.push(`
## Style
`, "You may include a short paragraph (2-3 sentences) for significant features. Use bullet points for smaller changes.");
  }
  return parts.join(`
`);
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
    const result = spawnSync("claude", [
      "-p",
      "--bare",
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
    ], {
      encoding: "utf-8",
      cwd: repoRoot,
      timeout: 300000,
      maxBuffer: 1e7
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `Exit code ${result.status}`);
    }
    notes = result.stdout.trim();
    if (!notes)
      throw new Error("Empty response from Claude");
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
main().catch((err) => {
  console.log(`::error::${err.message}`);
  process.exit(1);
});
