/**
 * Coalesce a horizontal BAND of anchored pictures into one in-flow
 * `InlineFrame` block.
 *
 * Flyers place several images side-by-side at a FIXED position to form a
 * banner strip (the USDA farm-loss handout: three portrait photos across the
 * page). In OOXML each is its own `<wp:anchor>` picture, all sharing one
 * anchor paragraph and the same vertical band. Two render paths both get it
 * wrong:
 *   - `floatWrappingImages` turns each into a CSS float and `floatSide`
 *     scatters them to opposite margins, so the row collapses and body text
 *     fills the gaps;
 *   - a plain absolute overlay keeps the row but reserves NO flow space, so
 *     the text below collides with the band.
 *
 * Instead we group such pictures into a single `InlineFrame` placed at the
 * (empty) anchor paragraph — the same in-flow, height-reserving wrapper the
 * `<wp:inline>` drawing groups use, with each picture absolute-positioned at
 * its intra-band offset. The band keeps its row layout and the body text
 * flows BELOW it, matching Word. Runs BEFORE `floatWrappingImages` so a lone
 * wrap-around image still floats as before.
 */

import type {
  AnchoredContent,
  AnchoredFrame,
  Block,
  InlineFrame,
  Paragraph,
} from "../../doc/types";

/** Wrap modes that, for a single image, would otherwise be floated. */
const DISPLACING_WRAPS = new Set(["square", "tight", "through"]);

function isBandPicture(frame: AnchoredFrame): boolean {
  return (
    !frame.behindText &&
    frame.anchor.paragraphIndex !== undefined &&
    frame.content.kind === "picture" &&
    frame.wrap !== undefined &&
    DISPLACING_WRAPS.has(frame.wrap)
  );
}

/**
 * Replace each qualifying picture band with an `InlineFrame` at its anchor
 * paragraph and drop those frames from the overlay set. Pure — inputs
 * untouched. Body length is preserved (the empty anchor paragraph is
 * REPLACED, never removed), so downstream paragraph indices stay valid.
 */
export function groupAnchoredPictureBands(
  body: readonly Block[],
  frames: readonly AnchoredFrame[],
): { body: Block[]; frames: AnchoredFrame[] } {
  // Bucket candidate pictures by their shared anchor paragraph.
  const byParagraph = new Map<number, AnchoredFrame[]>();
  for (const frame of frames) {
    if (!isBandPicture(frame)) continue;
    const pi = frame.anchor.paragraphIndex as number;
    (byParagraph.get(pi) ?? byParagraph.set(pi, []).get(pi)!).push(frame);
  }

  const newBody = body.slice();
  const banded = new Set<string>();

  for (const [pi, group] of byParagraph) {
    if (group.length < 2) continue; // a lone image stays a float
    if (!sharesCoordinateOrigin(group)) continue; // offsets must be comparable
    if (!sharesVerticalBand(group)) continue; // a horizontal row, not a stack
    const target = newBody[pi];
    // Only claim an EMPTY anchor paragraph: turning it into the band loses no
    // text, and keeps the body the same length (no index shift).
    if (!target || target.kind !== "paragraph" || !isEmptyParagraph(target)) continue;

    newBody[pi] = buildBand(group, target);
    for (const f of group) banded.add(f.id);
  }

  if (banded.size === 0) return { body: body.slice(), frames: frames.slice() };
  return { body: newBody, frames: frames.filter((f) => !banded.has(f.id)) };
}

/** All frames measured from the same H/V origin, so their raw offsets can be
 *  compared directly when laying out the band. */
function sharesCoordinateOrigin(group: readonly AnchoredFrame[]): boolean {
  const h = group[0]!.anchor.horizontalFrom;
  const v = group[0]!.anchor.verticalFrom;
  return group.every((f) => f.anchor.horizontalFrom === h && f.anchor.verticalFrom === v);
}

/** The frames overlap a common vertical interval — a side-by-side row rather
 *  than a vertical stack (max of tops < min of bottoms). */
function sharesVerticalBand(group: readonly AnchoredFrame[]): boolean {
  const maxTop = Math.max(...group.map((f) => f.offsetYEmu));
  const minBottom = Math.min(...group.map((f) => f.offsetYEmu + f.heightEmu));
  return maxTop < minBottom;
}

function buildBand(group: readonly AnchoredFrame[], host: Paragraph): InlineFrame {
  // Left-to-right so DOM order matches reading order (and later images paint
  // on top at the seams where the band slightly overlaps).
  const ordered = [...group].sort((a, b) => a.offsetXEmu - b.offsetXEmu);
  const minX = Math.min(...ordered.map((f) => f.offsetXEmu));
  const minY = Math.min(...ordered.map((f) => f.offsetYEmu));
  const maxX = Math.max(...ordered.map((f) => f.offsetXEmu + f.widthEmu));
  const maxY = Math.max(...ordered.map((f) => f.offsetYEmu + f.heightEmu));
  const extent = { wEmu: maxX - minX, hEmu: maxY - minY };

  const pictures = ordered.map((f) => {
    const pic = f.content as Extract<AnchoredContent, { kind: "picture" }>;
    return {
      partPath: pic.partPath,
      offsetEmu: { xEmu: f.offsetXEmu - minX, yEmu: f.offsetYEmu - minY },
      sizeEmu: { wEmu: f.widthEmu, hEmu: f.heightEmu },
      ...(pic.altText !== undefined ? { altText: pic.altText } : {}),
    };
  });

  return {
    kind: "inline_frame",
    groupExtentEmu: extent,
    sizeEmu: extent,
    textboxes: [],
    shapes: [],
    pictures,
    // Carry the anchor paragraph's spacing so the band reserves the same
    // vertical box Word does (drawing height + the paragraph's spacing-after).
    ...(host.properties ? { hostProps: host.properties } : {}),
  };
}

function isEmptyParagraph(p: Paragraph): boolean {
  return p.runs.every((r) => r.kind === "text" && r.text.trim() === "");
}
