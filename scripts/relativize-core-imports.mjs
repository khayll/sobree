#!/usr/bin/env node
import { execSync } from "node:child_process";
/**
 * Convert `@/...` aliased imports inside packages/core/src to relative paths.
 *
 * The alias is fine for in-package dev, but breaks transitive type-checking
 * from consumers (apps/demo, future external packages) — TS sees the
 * imports through node_modules and has no idea what `@/` means in the
 * core package's context.
 *
 * Run from repo root: `node scripts/relativize-core-imports.mjs`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreSrc = join(repoRoot, "packages/core/src");

// Find every .ts and .css file in the core package.
const files = execSync(`find "${coreSrc}" -type f \\( -name '*.ts' -o -name '*.css' \\)`, {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

let touched = 0;

// Match the import sources we want to rewrite. Captures the path after `@/`.
//   import X from "@/foo/bar"
//   import "@/foo/bar.css"
//   } from "@/foo/bar";
//   @import "@/foo/bar.css";   (CSS files)
const PATTERN = /(["'])@\/([^"']+)\1/g;

for (const file of files) {
  const original = readFileSync(file, "utf8");
  const fileDir = dirname(file);
  let changed = false;
  const next = original.replace(PATTERN, (_match, quote, aliased) => {
    changed = true;
    // Resolve aliased target against core's src/ root.
    const absoluteTarget = join(coreSrc, aliased);
    let rel = relative(fileDir, absoluteTarget);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${quote}${rel}${quote}`;
  });
  if (changed) {
    writeFileSync(file, next);
    touched++;
  }
}

console.log(`relativized ${touched} files in packages/core/src`);
