import type { Block, InlineRun } from "../../doc/types";

/**
 * After a frame read-back, a freshly-typed character can land in a BARE
 * text node — outside the styled run's `<span>` — because browsers do
 * that at span boundaries. The serializer then emits a run with empty
 * properties, so a repaint renders it (and the paragraph's derived base
 * font) at the default tiny size: the "heading shrinks when I type" bug.
 *
 * Give each empty-property text run the properties of its nearest styled
 * neighbour (previous, else next), so typed text inherits the surrounding
 * run's font / colour — exactly how a caret's typing style should behave.
 * Frame-only: body runs legitimately carry empty props and inherit from
 * named styles at render, so the editor doesn't apply this to body flow.
 */
export function inheritBareRunStyling(blocks: Block[]): Block[] {
  const isEmpty = (p: object): boolean => Object.keys(p).length === 0;
  return blocks.map((b) => {
    if (b.kind !== "paragraph") return b;
    const runs = b.runs as InlineRun[];
    const styledPropsNear = (i: number) => {
      for (let j = i - 1; j >= 0; j--) {
        const r = runs[j];
        if (r?.kind === "text" && !isEmpty(r.properties)) return r.properties;
      }
      for (let j = i + 1; j < runs.length; j++) {
        const r = runs[j];
        if (r?.kind === "text" && !isEmpty(r.properties)) return r.properties;
      }
      return null;
    };
    let changed = false;
    const newRuns = runs.map((r, i) => {
      if (r.kind !== "text" || !isEmpty(r.properties)) return r;
      const donor = styledPropsNear(i);
      if (!donor) return r;
      changed = true;
      return { ...r, properties: { ...donor } };
    });
    return changed ? { ...b, runs: newRuns } : b;
  });
}
