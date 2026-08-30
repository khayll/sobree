/**
 * Theme font slot resolution — the import post-pass.
 *
 * `readRunProperties` records `fontThemeSlot` as pure syntax (no theme
 * part needed at read time, so nothing threads through the paragraph
 * walkers). This pass then resolves every slot against the document's
 * `<a:fontScheme>` into a concrete `fontFamily` — theme SUPERSEDES any
 * literal `w:ascii` beside it (ECMA-376 §17.3.2.26; Word leaves stale
 * literals around precisely because the theme wins). The slot is kept
 * after resolution so export re-emits the linkage and Word retheming
 * still works on a saved file.
 *
 * Without a theme part the slots stay unresolved and the literal (or
 * the styles baseline fallback) stands — today's behavior.
 */

import type { AnchoredFrame, Block, RunProperties, SobreeDocument } from "../../doc/types";
import { walkBlock } from "../../doc/walk";

export function resolveThemeFontSlots(doc: SobreeDocument): void {
  const fonts = doc.themeFonts;
  if (!fonts || (fonts.major === undefined && fonts.minor === undefined)) return;

  const apply = (props: RunProperties | undefined): void => {
    if (!props) return;
    if (props.fontThemeSlot) {
      const face = fonts[props.fontThemeSlot];
      if (face) props.fontFamily = face;
    }
    // The tracked format-change snapshot is a RunProperties too.
    apply(props.revisionFormat?.before);
  };
  const visitor = {
    block: (b: Block) => {
      // walkBlock descends paragraph/table only; inline_frame textbox
      // bodies (body OR header/footer parts) are visited here.
      if (b.kind === "inline_frame") for (const tb of b.textboxes) applyBlocks(tb.body);
    },
    paragraph: (p: { properties: { runDefaults?: RunProperties } }) => {
      apply(p.properties.runDefaults);
    },
    run: (r: unknown) => {
      apply((r as { properties?: RunProperties }).properties);
    },
  };
  const applyBlocks = (blocks: readonly Block[] | undefined): void => {
    for (const b of blocks ?? []) walkBlock(b, visitor);
  };

  applyBlocks(doc.body);
  for (const body of Object.values(doc.headerFooterBodies ?? {})) applyBlocks(body);
  for (const body of Object.values(doc.footnotes ?? {})) applyBlocks(body);
  for (const body of Object.values(doc.endnotes ?? {})) applyBlocks(body);
  for (const c of Object.values(doc.comments ?? {})) applyBlocks(c.body);

  // Textbox bodies live OUTSIDE the block tree: anchored frames (body +
  // header/footer overlays, groups recursively) and inline-frame group
  // textboxes each carry their own Block[].
  const applyFrames = (frames: readonly AnchoredFrame[] | undefined): void => {
    for (const f of frames ?? []) {
      if (f.content.kind === "textbox") applyBlocks(f.content.body);
      else if (f.content.kind === "group") applyFrames(f.content.children);
    }
  };
  applyFrames(doc.anchoredFrames);
  for (const frames of Object.values(doc.headerFooterFrames ?? {})) applyFrames(frames);
  for (const frame of doc.inlineFrames ?? []) {
    for (const tb of frame.textboxes) applyBlocks(tb.body);
  }

  for (const style of doc.styles) {
    apply(style.runDefaults);
    apply(style.paragraphDefaults?.runDefaults);
  }
}
