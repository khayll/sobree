/**
 * Unicode word-boundary math for `deleteWord*` — pure string helpers, split out
 * of `trackedInput` so the input router stays focused on event routing.
 */

import type { Paragraph } from "../../doc/types";

/**
 * Offset-aligned plain text of a paragraph: text runs contribute their
 * characters; every other inline (image, tab, field, …) contributes ONE
 * object-replacement char, so an index into this string IS an `InlinePosition`
 * offset (which counts each non-text run as 1) and a word boundary never runs
 * across a non-text run.
 */
export function offsetAlignedText(block: Paragraph): string {
  let out = "";
  for (const run of block.runs) out += run.kind === "text" ? run.text : "￼";
  return out;
}

/** Start offset of a `deleteWordBackward` from `offset`: back over any trailing
 *  whitespace, then over the preceding word (Unicode word segmentation). */
export function wordBackwardStart(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const segs = [
    ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text.slice(0, offset)),
  ];
  let i = segs.length - 1;
  while (i >= 0 && !segs[i]!.isWordLike && segs[i]!.segment.trim() === "") i--;
  return i >= 0 ? segs[i]!.index : 0;
}

/** End offset of a `deleteWordForward` from `offset`: forward over any leading
 *  whitespace, then over the following word. */
export function wordForwardEnd(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  const after = text.slice(offset);
  const segs = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(after)];
  let i = 0;
  while (i < segs.length && !segs[i]!.isWordLike && segs[i]!.segment.trim() === "") i++;
  return i < segs.length ? offset + segs[i]!.index + segs[i]!.segment.length : text.length;
}
