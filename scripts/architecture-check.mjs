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

const coreSrc = path.join(root, "packages/core/src");
const isTestFile = (file) => /\.(test|bench)\.[cm]?[jt]sx?$/.test(file);

/**
 * Every module specifier a source file imports: `from "x"`, side-effect
 * `import "x"`, `export … from "x"`, dynamic `import("x")`, `require("x")`.
 * Deliberately regex-based (not a real parser) so it also sees TYPE-ONLY
 * imports — the class of boundary violation archunit's dependency graph
 * misses, and the reason these checks exist alongside the fitness tests.
 */
function* importSpecifiers(text) {
  const re =
    /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(re)) {
    yield match[1] ?? match[2] ?? match[3] ?? match[4];
  }
}

/**
 * Resolve a relative import from `file` to a path relative to
 * `packages/core/src` (posix-normalized). Returns `null` for bare/package
 * specifiers — those are handled by the cross-package internal check.
 */
function resolveCoreRel(file, spec) {
  if (!spec.startsWith(".")) return null;
  const abs = path.resolve(path.dirname(file), spec);
  return path.relative(coreSrc, abs).split(path.sep).join("/");
}

/** True when the core-relative path is inside one of `dirs` (a top zone). */
function inZone(coreRel, dirs) {
  return dirs.some((dir) => coreRel === dir || coreRel.startsWith(`${dir}/`));
}

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

// Pure document/model zones that must not depend UPWARD on the browser
// editor, embedder shell, or in-place zone editor. Catches type-only
// imports too (archunit doesn't). `paperStack` is deliberately absent
// here — a few pure modules still consume `paperStack/pageSetup` page
// geometry, which is a separate ownership question (see the plan). The
// stricter mutation-engine rule below DOES forbid paperStack/ydoc.
const pureZoneDirs = ["doc", "ydoc", "pagination", "docx"];
const forbiddenForPureZones = ["editor", "embed", "zoneEdit"];

// The pure mutation engine is the shared owner of user-visible document
// mutations. It must stay free of DOM / editor / Y.Doc / renderer /
// paperStack imports so both the browser Editor and HeadlessSobree can
// call it — see AGENTS.md "HeadlessSobree (Tier 2)".
const mutationEngineForbidden = ["editor", "embed", "zoneEdit", "paperStack", "ydoc"];

async function checkPureZoneImports() {
  for (const zone of pureZoneDirs) {
    for await (const file of walk(path.join(coreSrc, zone))) {
      if (!sourceExtensions.has(path.extname(file)) || isTestFile(file)) continue;
      const text = await readFile(file, "utf8");
      for (const spec of importSpecifiers(text)) {
        const coreRel = resolveCoreRel(file, spec);
        if (coreRel && inZone(coreRel, forbiddenForPureZones)) {
          failures.push(
            `${rel(file)} (pure ${zone}/ zone) must not import editor/embed/zoneEdit: "${spec}"`,
          );
        }
      }
    }
  }
}

// `paperStack` is a DOM layout adapter that legitimately depends on
// `editor/view/docRenderer` — but it must not reach into `editor/internal`
// (the editor's private surface). Selection preservation across a
// repagination rebuild lives in the non-internal `editor/selectionMap`
// instead (Phase 4 of the ownership plan).
async function checkPaperStackNoEditorInternals() {
  for await (const file of walk(path.join(coreSrc, "paperStack"))) {
    if (!sourceExtensions.has(path.extname(file))) continue;
    const text = await readFile(file, "utf8");
    for (const spec of importSpecifiers(text)) {
      const coreRel = resolveCoreRel(file, spec);
      if (coreRel && inZone(coreRel, ["editor/internal"])) {
        failures.push(
          `${rel(file)} must not import editor internals — use a non-internal editor module (e.g. editor/selectionMap): "${spec}"`,
        );
      }
    }
  }
}

async function checkMutationEnginePurity() {
  for await (const file of walk(path.join(coreSrc, "doc/mutations"))) {
    if (!sourceExtensions.has(path.extname(file)) || isTestFile(file)) continue;
    const text = await readFile(file, "utf8");
    for (const spec of importSpecifiers(text)) {
      const coreRel = resolveCoreRel(file, spec);
      if (coreRel && inZone(coreRel, mutationEngineForbidden)) {
        failures.push(
          `${rel(file)} (pure mutation engine) must not import editor/embed/zoneEdit/paperStack/ydoc: "${spec}"`,
        );
      }
    }
  }
}

// Every source file allowed to be named exactly `utils.*` / `helpers.*`.
// Empty by design: AGENTS.md forbids erasing ownership into a generic
// helper module. Add an exact path here only with a named domain reason.
const genericHelperAllowlist = new Set([]);
const genericHelperNames = /^(utils|helpers)\.[cm]?[jt]sx?$/;

async function checkNoGenericHelperFiles() {
  const roots = ["packages", "apps", "tools"];
  for (const dirName of roots) {
    for await (const file of walk(path.join(root, dirName))) {
      if (!genericHelperNames.test(path.basename(file))) continue;
      if (genericHelperAllowlist.has(rel(file))) continue;
      failures.push(
        `${rel(file)} is a generic helper file — give the module a name that states the domain concept it owns (AGENTS.md)`,
      );
    }
  }
}

// Plugins must not hardcode the paper-stack layout protocol — the
// `.paper` / `.paper-row` / `.paper-comments` / `.paper-header` /
// `.paper-footer` page-DOM class names. They go through the typed
// `sobree.paperLayout` bridge (AGENTS.md: "Plugins hardcoding rendered
// DOM protocol selectors" is a fail). Matches those exact class tokens
// inside a quoted string (selector args); the negative lookahead keeps
// sibling classes like `.paper-content` out of scope. Backtick-quoted
// prose in comments (`` `.paper` ``) is not a string literal, so it's
// naturally excluded.
const paperSelectorRe = /["']\.paper(-row|-comments|-header|-footer)?(?![\w-])/;

async function checkPluginPaperSelectors() {
  for (const { dir } of siblingPlugins.map((name) => ({
    dir: path.join(root, "packages", name.replace("@sobree/", ""), "src"),
  }))) {
    for await (const file of walk(dir)) {
      if (!sourceExtensions.has(path.extname(file))) continue;
      const text = await readFile(file, "utf8");
      for (const line of text.split("\n")) {
        if (paperSelectorRe.test(line)) {
          failures.push(
            `${rel(file)} hardcodes a paper-stack layout selector — use the typed \`sobree.paperLayout\` bridge: ${line.trim().slice(0, 80)}`,
          );
        }
      }
    }
  }
}

// A package deep-importing another package's `internal` folder bypasses
// its public surface. Cross-package imports go through the `@sobree/*`
// specifier, so an internal reach looks like `@sobree/pkg/…/internal…`.
const crossPackageInternalRe = /^@sobree\/[^/]+\/[^"']*internal/;

async function checkCrossPackageInternalImports() {
  for await (const file of walk(path.join(root, "packages"))) {
    if (!sourceExtensions.has(path.extname(file))) continue;
    const text = await readFile(file, "utf8");
    for (const spec of importSpecifiers(text)) {
      if (crossPackageInternalRe.test(spec)) {
        failures.push(`${rel(file)} deep-imports another package's internal surface: "${spec}"`);
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
await checkPureZoneImports();
await checkMutationEnginePurity();
await checkPaperStackNoEditorInternals();
await checkNoGenericHelperFiles();
await checkPluginPaperSelectors();
await checkCrossPackageInternalImports();
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
