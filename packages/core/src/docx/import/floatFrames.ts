/**
 * Convert wrap-mode anchored PICTURES into in-flow CSS floats.
 *
 * An anchored image with a displacing wrap (square / tight / through)
 * makes Word flow body text AROUND it. Sobree paints anchored frames in
 * an absolute overlay, which can't wrap text. The CSS-native equivalent is
 * a `float`: a floated image shortens the line boxes of its paragraph (and
 * the following paragraphs, in a block formatting context) until its
 * height is exhausted — exactly Word's wrap. So we lift such a frame out
 * of the overlay set and prepend it as a float `DrawingRun` to its anchor
 * paragraph.
 *
 * Scope — everything else stays an absolute overlay:
 *   - picture content (textboxes are handled by `flowDisplacingTextboxes`),
 *   - a displacing wrap (square / tight / through — not none / topAndBottom),
 *   - paragraph-anchored (we know which paragraph to inject into),
 *   - not behind-text.
 *
 * `wrapText` picks the side directly when set to left/right; for the
 * default `bothSides` / `largest` (CSS can't put text on both sides) the
 * image floats to whichever margin it sits nearer, decided from its real
 * horizontal position in the section — not a magic constant.
 */

import type {
  AnchoredContent,
  AnchoredFrame,
  Block,
  DrawingRun,
  SectionProperties,
} from "../../doc/types";

/** 1 twip (1/20 pt) = 635 EMU. */
const EMU_PER_TWIP = 635;

function isFloatable(frame: AnchoredFrame): boolean {
  if (frame.behindText) return false;
  if (frame.anchor.paragraphIndex === undefined) return false;
  if (frame.content.kind !== "picture") return false;
  switch (frame.wrap) {
    case "square":
    case "tight":
    case "through":
      return true;
    default:
      return false;
  }
}

/**
 * Prepend a float `DrawingRun` to each floatable frame's anchor paragraph
 * and drop those frames from the overlay set. Pure — inputs untouched.
 * Body indices are stable (we modify paragraphs in place, never insert),
 * so it composes after `flowDisplacingTextboxes` without an index remap.
 */
export function floatWrappingImages(
  body: readonly Block[],
  frames: readonly AnchoredFrame[],
  sections: readonly SectionProperties[],
): { body: Block[]; frames: AnchoredFrame[] } {
  const floatable = frames.filter(isFloatable);
  if (floatable.length === 0) {
    return { body: body.slice(), frames: frames.slice() };
  }

  const newBody = body.slice();
  const floatedIds = new Set<string>();

  for (const frame of floatable) {
    const pi = frame.anchor.paragraphIndex as number;
    const target = newBody[pi];
    // The anchor must be a real paragraph to host the float run; if the
    // index landed on a non-paragraph (or out of range), leave it an overlay.
    if (!target || target.kind !== "paragraph") continue;
    newBody[pi] = { ...target, runs: [toFloatRun(frame, sections), ...target.runs] };
    floatedIds.add(frame.id);
  }

  return {
    body: newBody,
    frames: frames.filter((f) => !floatedIds.has(f.id)),
  };
}

function toFloatRun(frame: AnchoredFrame, sections: readonly SectionProperties[]): DrawingRun {
  const pic = frame.content as Extract<AnchoredContent, { kind: "picture" }>;
  const run: DrawingRun = {
    kind: "drawing",
    partPath: pic.partPath,
    widthEmu: frame.widthEmu,
    heightEmu: frame.heightEmu,
    placement: floatSide(frame, sections),
  };
  if (pic.altText !== undefined) run.altText = pic.altText;
  if (frame.textDistancesEmu) run.floatMarginsEmu = frame.textDistancesEmu;
  return run;
}

function floatSide(
  frame: AnchoredFrame,
  sections: readonly SectionProperties[],
): "floatLeft" | "floatRight" {
  // Explicit side wins: wrapText="right" means text flows on the image's
  // right → the image floats LEFT; "left" → floats RIGHT.
  if (frame.wrapText === "right") return "floatLeft";
  if (frame.wrapText === "left") return "floatRight";

  // bothSides / largest / unset: CSS can't wrap on both sides, so float to
  // whichever margin the image sits nearer — its real position picks the
  // dominant text column.
  const section = sections[frame.anchor.sectionIndex] ?? sections[0];
  if (!section) return "floatLeft";
  const leftMarginEmu = (section.pageMargins.leftTwips ?? 0) * EMU_PER_TWIP;
  const rightMarginEmu = (section.pageMargins.rightTwips ?? 0) * EMU_PER_TWIP;
  const pageWidthEmu = (section.pageSize.wTwips ?? 0) * EMU_PER_TWIP;
  const contentLeftEmu = frame.anchor.horizontalFrom === "page" ? 0 : leftMarginEmu;
  const frameCenterEmu = contentLeftEmu + frame.offsetXEmu + frame.widthEmu / 2;
  const contentCenterEmu = leftMarginEmu + (pageWidthEmu - leftMarginEmu - rightMarginEmu) / 2;
  return frameCenterEmu >= contentCenterEmu ? "floatRight" : "floatLeft";
}
