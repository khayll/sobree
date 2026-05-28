#!/usr/bin/env node
// Pick the narrowest test scope that still covers the changed files.
//
// Most edits touch ONE area (docx import, paginator, renderer, etc.).
// Running `pnpm test` runs all 649 tests in 7 packages (~30s+); the
// changes only ever break a handful of tests in the same package.
//
// Strategy:
//   1. Read changed files via `git diff --name-only` (working tree +
//      staged, optionally vs an explicit base — passed as `--base=…`).
//   2. Group by package; map each package to its test command.
//   3. Always include the oracle test when any `packages/core/src`
//      file changed AND the change isn't purely a `.css` file — the
//      oracle test is fast (~1s) and catches AST regressions across
//      all corpus entries.
//
// Falls back to a full `pnpm test` if it can't decide (new top-level
// file, unfamiliar package, etc.) — better safe than skipping tests.
//
// Usage:
//   pnpm test:related              # vs working tree (uncommitted)
//   pnpm test:related --base=main  # vs main branch (PR-style diff)

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("--base="))?.slice(7) ?? "";

// `git diff --name-only HEAD` fails if HEAD doesn't exist (fresh repo,
// no commits yet). Probe HEAD first; fall back to the working-tree-vs-
// index diff (which always works) when there's no HEAD.
let hasHead = false;
try {
  execSync("git rev-parse --verify HEAD", { stdio: "pipe" });
  hasHead = true;
} catch { /* no HEAD yet */ }

let diffCmd;
if (base) {
  diffCmd = `git diff --name-only ${base}...HEAD ; git diff --name-only`;
} else if (hasHead) {
  diffCmd = "git diff --name-only HEAD";
} else {
  // Fresh repo: every tracked file is "new". Diff the index + working
  // tree against the empty tree object so we see everything.
  const emptyTree = execSync("git hash-object -t tree /dev/null", { encoding: "utf8" }).trim();
  diffCmd = `git diff --name-only ${emptyTree}`;
}

const diff = execSync(diffCmd, { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.length > 0);

if (diff.length === 0) {
  console.log("No changes detected — nothing to test.");
  process.exit(0);
}

// Bucket changes by package.
const buckets = {
  core: false,
  /** Plugin / sibling packages (each has its own test suite). */
  blockTools: false,
  keyboard: false,
  zoomControls: false,
  review: false,
  collabProviders: false,
  collabServer: false,
  mcp: false,
  /** Fixtures + oracle test should re-run when a docx is added /
   *  changed AND when any AST-touching code in core changes. */
  oracle: false,
  /** Root-level or unknown — be safe and run everything. */
  unknown: false,
};

for (const file of diff) {
  if (file.startsWith("packages/core/src/")) {
    buckets.core = true;
    // CSS-only changes don't affect AST snapshots.
    if (!file.endsWith(".css")) buckets.oracle = true;
  } else if (file.startsWith("packages/block-tools/")) buckets.blockTools = true;
  else if (file.startsWith("packages/keyboard/")) buckets.keyboard = true;
  else if (file.startsWith("packages/zoom-controls/")) buckets.zoomControls = true;
  else if (file.startsWith("packages/review/")) buckets.review = true;
  else if (file.startsWith("packages/collab-providers/")) buckets.collabProviders = true;
  else if (file.startsWith("packages/collab-server/")) buckets.collabServer = true;
  else if (file.startsWith("packages/mcp/")) buckets.mcp = true;
  else if (file.startsWith("tests/corpus/")) buckets.oracle = true;
  else if (file.startsWith("apps/")) {
    // Apps don't have tests; the playground / docs are dev-only. Skip.
  } else if (file.startsWith("tools/")) {
    // Tools have their own scripts; oracle covers their output.
    buckets.oracle = true;
  } else if (file.endsWith(".md") || file === ".gitignore" || file === "AGENTS.md") {
    // Docs / config — no test needed.
  } else {
    // Root-level package.json, scripts, lockfile, etc.
    buckets.unknown = true;
  }
}

const commands = [];
if (buckets.unknown) {
  commands.push(["pnpm", ["test"]]);
} else {
  if (buckets.core) commands.push(["pnpm", ["-F", "@sobree/core", "test"]]);
  if (buckets.blockTools) commands.push(["pnpm", ["-F", "@sobree/block-tools", "test"]]);
  if (buckets.keyboard) commands.push(["pnpm", ["-F", "@sobree/keyboard", "test"]]);
  if (buckets.zoomControls) commands.push(["pnpm", ["-F", "@sobree/zoom-controls", "test"]]);
  if (buckets.review) commands.push(["pnpm", ["-F", "@sobree/review", "test"]]);
  if (buckets.collabProviders) commands.push(["pnpm", ["-F", "@sobree/collab-providers", "test"]]);
  if (buckets.collabServer) commands.push(["pnpm", ["-F", "@sobree/collab-server", "test"]]);
  if (buckets.mcp) commands.push(["pnpm", ["-F", "@sobree/mcp", "test"]]);
  // If we ran the core suite, the oracle test is already covered by
  // `pnpm -F @sobree/core test`. Otherwise (e.g. fixture-only change),
  // run it standalone.
  if (buckets.oracle && !buckets.core) {
    commands.push(["pnpm", ["-F", "@sobree/core", "test", "--", "fixtures.oracle"]]);
  }
}

if (commands.length === 0) {
  console.log("Changes detected, but none touch a tested package — skipping tests.");
  console.log("Changed files:");
  for (const f of diff) console.log(`  ${f}`);
  process.exit(0);
}

console.log(`Running ${commands.length} test command(s) based on ${diff.length} changed file(s):`);
for (const [cmd, args] of commands) console.log(`  ${cmd} ${args.join(" ")}`);
console.log("");

let exitCode = 0;
for (const [cmd, args] of commands) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) exitCode = r.status ?? 1;
}
process.exit(exitCode);
