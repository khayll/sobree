#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const siblingPlugins = [
  "@sobree/block-tools",
  "@sobree/keyboard",
  "@sobree/review",
  "@sobree/zoom-controls",
];
const forbiddenFrameworks = [
  "react",
  "react-dom",
  "solid-js",
  "vue",
  "@vue/*",
  "prosemirror-*",
  "@tiptap/*",
  "lexical",
];
const forbiddenLockfiles = ["package-lock.json", "yarn.lock"];
const longFileLineLimit = 300;
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"]);
const ignoredDirNames = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".claude",
  ".turbo",
  ".astro",
  "baseline",
  "baselines",
  "snapshots",
  "__snapshots__",
  "fixtures",
]);
const ignoredPathParts = [
  `${path.sep}apps${path.sep}docs${path.sep}src${path.sep}content${path.sep}docs${path.sep}`,
  `${path.sep}.changeset${path.sep}`,
];

const failures = [];
const warnings = [];

const rel = (file) => path.relative(root, file).split(path.sep).join("/");

function isIgnored(file) {
  return ignoredPathParts.some((part) => file.includes(part));
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirNames.has(entry.name) || isIgnored(fullPath)) continue;
      yield* walk(fullPath);
    } else if (entry.isFile() && !isIgnored(fullPath)) {
      yield fullPath;
    }
  }
}

function collectDeps(pkg) {
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
}

function importRegex(packageName) {
  const escaped = packageName.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[^'\"]*");
  return new RegExp(
    `(?:from\\s+|import\\s+|import\\s*\\(\\s*|require\\(\\s*)["']${escaped}(?:/[^"']*)?["']`,
    "g",
  );
}

async function checkCorePackageDeps() {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "packages/core/package.json"), "utf8"),
  );
  const deps = collectDeps(packageJson);
  for (const plugin of siblingPlugins) {
    if (deps.has(plugin)) {
      failures.push(`packages/core/package.json must not depend on sibling plugin ${plugin}`);
    }
  }
}

async function checkForbiddenLockfiles() {
  for (const lockfile of forbiddenLockfiles) {
    try {
      await stat(path.join(root, lockfile));
      failures.push(`Forbidden lockfile exists: ${lockfile}`);
    } catch {}
  }
}

async function checkImports() {
  const pluginSourceRoots = siblingPlugins.map((name) => ({
    name,
    dir: path.join(root, "packages", name.replace("@sobree/", ""), "src"),
  }));

  for (const { name, dir } of pluginSourceRoots) {
    for await (const file of walk(dir)) {
      if (!sourceExtensions.has(path.extname(file))) continue;
      const text = await readFile(file, "utf8");
      for (const plugin of siblingPlugins) {
        if (plugin === name) continue;
        if (importRegex(plugin).test(text)) {
          failures.push(`${rel(file)} must not import sibling plugin ${plugin}`);
        }
      }
    }
  }

  const coreSrc = path.join(root, "packages/core/src");
  for await (const file of walk(coreSrc)) {
    if (!sourceExtensions.has(path.extname(file))) continue;
    const text = await readFile(file, "utf8");
    for (const framework of forbiddenFrameworks) {
      if (importRegex(framework).test(text)) {
        failures.push(`${rel(file)} must not import forbidden framework ${framework}`);
      }
    }
  }
}

async function reportLongFiles() {
  for await (const file of walk(root)) {
    if (!sourceExtensions.has(path.extname(file))) continue;
    const lineCount = (await readFile(file, "utf8")).split("\n").length;
    if (lineCount > longFileLineLimit) {
      warnings.push(`${rel(file)} has ${lineCount} lines (warn threshold ${longFileLineLimit})`);
    }
  }
}

await checkCorePackageDeps();
await checkForbiddenLockfiles();
await checkImports();
await reportLongFiles();

if (warnings.length) {
  console.warn("Architecture warnings:");
  for (const warning of warnings) console.warn(`  - ${warning}`);
}

if (failures.length) {
  console.error("Architecture violations:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Architecture check passed.");
}
