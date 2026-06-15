#!/usr/bin/env node
/**
 * Docs-coverage ratchet: every public export of every published package
 * must be mentioned somewhere in the docs content, or be explicitly
 * listed in scripts/docs-coverage.allow (the debt list).
 *
 * The allowlist may only SHRINK:
 *   - a new export that is neither documented nor allowlisted → FAIL
 *     (document it, per the AGENTS.md update checklist)
 *   - an allowlist entry that is now documented or no longer exported
 *     → FAIL (delete the line — debt that's paid off doesn't linger)
 *
 * "Mentioned" is a word-boundary match across apps/docs content — a
 * deliberately cheap proxy. It catches forgotten NEW surface; it cannot
 * catch stale prose (that's PR.md review discipline).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = {
  core: "packages/core/src/index.ts",
  "block-tools": "packages/block-tools/src/index.ts",
  keyboard: "packages/keyboard/src/index.ts",
  "zoom-controls": "packages/zoom-controls/src/index.ts",
  review: "packages/review/src/index.ts",
  "collab-providers": "packages/collab-providers/src/index.ts",
  "collab-server": "packages/collab-server/src/index.ts",
  mcp: "packages/mcp/src/index.ts",
};
const DOCS_DIR = "apps/docs/src/content/docs";
const ALLOW_FILE = "scripts/docs-coverage.allow";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(md|mdx)$/.test(name) ? [p] : [];
  });
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function exportsOf(indexPath) {
  const src = stripComments(readFileSync(indexPath, "utf8"));
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (let part of m[1].split(",")) {
      part = part.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const name = part.includes(" as ") ? part.split(" as ").pop().trim() : part;
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z0-9_$]+)/g,
  )) {
    names.add(m[1]);
  }
  return names;
}

const docs = walk(DOCS_DIR)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const allow = new Set(
  readFileSync(ALLOW_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#")),
);

const mentioned = (name) => new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(docs);

const newlyUndocumented = [];
const allExports = new Set();
for (const [pkg, indexPath] of Object.entries(PACKAGES)) {
  for (const name of exportsOf(indexPath)) {
    const key = `${pkg}:${name}`;
    allExports.add(key);
    if (!mentioned(name) && !allow.has(key)) newlyUndocumented.push(key);
  }
}
const staleAllow = [...allow].filter((key) => {
  if (!allExports.has(key)) return true; // export no longer exists
  return mentioned(key.split(":")[1]); // now documented
});

let failed = false;
if (newlyUndocumented.length) {
  failed = true;
  console.error("✗ public exports with no docs mention (document them, or consciously");
  console.error(`  add to ${ALLOW_FILE} with a reason — see AGENTS.md update checklist):`);
  for (const k of newlyUndocumented.sort()) console.error(`    ${k}`);
}
if (staleAllow.length) {
  failed = true;
  console.error(`✗ stale ${ALLOW_FILE} entries (now documented or no longer exported — delete):`);
  for (const k of staleAllow.sort()) console.error(`    ${k}`);
}
if (failed) process.exit(1);
console.log(
  `✓ docs coverage: ${allExports.size} public exports, ${allow.size} allowlisted (debt), 0 new gaps`,
);
