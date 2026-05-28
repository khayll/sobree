import type { InlineRun, RunProperties } from "./types";

/**
 * Character-length of a single InlineRun, matching the counting rules
 * used by the DOM ↔ position map:
 *   - TextRun → `text.length`.
 *   - BreakRun / TabRun / DrawingRun → 1 each.
 *   - FieldRun → length of its cached value (empty = 0).
 *   - HyperlinkRun → sum of its children's lengths.
 */
export function runLength(run: InlineRun): number {
  switch (run.kind) {
    case "text":
      return run.text.length;
    case "break":
    case "tab":
    case "drawing":
      return 1;
    case "field":
      return (run.cached ?? "").length;
    case "hyperlink":
      return runsLength(run.children);
    default:
      return 0;
  }
}

export function runsLength(runs: readonly InlineRun[]): number {
  let n = 0;
  for (const r of runs) n += runLength(r);
  return n;
}

/**
 * Split a runs array at `offset` characters from the start. Returns two
 * arrays whose concatenated content is equivalent to the input. Splitting
 * *through* a TextRun produces two TextRuns with the same properties;
 * splitting through an atom puts the whole atom on one side (ties go to
 * "before" at the atom's end boundary and "after" at the start boundary).
 */
export function splitRunsAt(
  runs: readonly InlineRun[],
  offset: number,
): { before: InlineRun[]; after: InlineRun[] } {
  const before: InlineRun[] = [];
  const after: InlineRun[] = [];
  let pos = 0;

  for (const run of runs) {
    const len = runLength(run);
    if (pos >= offset) {
      after.push(run);
      pos += len;
      continue;
    }
    if (pos + len <= offset) {
      before.push(run);
      pos += len;
      continue;
    }
    const splitAt = offset - pos;
    if (run.kind === "text") {
      before.push({ ...run, text: run.text.slice(0, splitAt) });
      after.push({ ...run, text: run.text.slice(splitAt) });
    } else if (run.kind === "hyperlink") {
      // Recurse into the hyperlink, preserving the href on both halves.
      const inner = splitRunsAt(run.children, splitAt);
      if (inner.before.length > 0) before.push({ ...run, children: inner.before });
      if (inner.after.length > 0) after.push({ ...run, children: inner.after });
    } else {
      // Atomic run — can't subdivide. Drop on the "after" side so the
      // "before" array never contains partial atoms.
      after.push(run);
    }
    pos += len;
  }
  return { before, after };
}

/**
 * Slice a runs array between two character offsets (inclusive `from`,
 * exclusive `to`). Used by `applyRunProperties` / `wrapRange` to isolate
 * the affected middle section.
 */
export function sliceRuns(
  runs: readonly InlineRun[],
  from: number,
  to: number,
): InlineRun[] {
  if (to <= from) return [];
  const head = splitRunsAt(runs, from);
  const tail = splitRunsAt(head.after, to - from);
  return tail.before;
}

/**
 * Patch shape accepted by `applyRunPropertiesToRuns`. Keys set to
 * `undefined` remove the corresponding property from affected runs;
 * keys set to a value override.
 */
export type RunPropertiesPatch = {
  [K in keyof RunProperties]?: RunProperties[K] | undefined;
};

/**
 * Return a new runs array with `patch` merged into every TextRun's
 * properties (and recursively into HyperlinkRun children). Atoms
 * without `properties` pass through unchanged.
 */
export function applyRunPropertiesToRuns(
  runs: readonly InlineRun[],
  patch: RunPropertiesPatch,
): InlineRun[] {
  return runs.map((r) => applyRunPropertiesToRun(r, patch));
}

function applyRunPropertiesToRun(run: InlineRun, patch: RunPropertiesPatch): InlineRun {
  if (run.kind === "text") {
    return { ...run, properties: mergeRunProps(run.properties, patch) };
  }
  if (run.kind === "hyperlink") {
    return { ...run, children: applyRunPropertiesToRuns(run.children, patch) };
  }
  return run;
}

function mergeRunProps(prev: RunProperties, patch: RunPropertiesPatch): RunProperties {
  const out: RunProperties = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (out as Record<string, unknown>)[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Concatenate runs and merge adjacent TextRuns with identical property
 * shapes. Minor cleanup for operations that leave fragmentation behind.
 */
export function mergeAdjacentTextRuns(runs: readonly InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (
      run.kind === "text" &&
      last &&
      last.kind === "text" &&
      JSON.stringify(last.properties) === JSON.stringify(run.properties)
    ) {
      out[out.length - 1] = { ...last, text: last.text + run.text };
    } else {
      out.push(run);
    }
  }
  return out;
}
