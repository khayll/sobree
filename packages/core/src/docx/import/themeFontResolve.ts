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

import type { Block, RunProperties, SobreeDocument } from "../../doc/types";
import { walk, walkBlock } from "../../doc/walk";

export function resolveThemeFontSlots(doc: SobreeDocument): void {
  const fonts = doc.themeFonts;
  if (!fonts || (fonts.major === undefined && fonts.minor === undefined)) return;

  const apply = (props: RunProperties | undefined): void => {
    if (!props?.fontThemeSlot) return;
    const face = fonts[props.fontThemeSlot];
    if (face) props.fontFamily = face;
  };
  const applyBlocks = (blocks: readonly Block[] | undefined): void => {
    for (const b of blocks ?? []) {
      walkBlock(b, {
        paragraph: (p) => {
          apply(p.properties.runDefaults);
        },
        run: (r) => {
          apply((r as { properties?: RunProperties }).properties);
        },
      });
    }
  };

  walk(doc, {
    paragraph: (p) => {
      apply(p.properties.runDefaults);
    },
    run: (r) => {
      apply((r as { properties?: RunProperties }).properties);
    },
  });
  for (const body of Object.values(doc.headerFooterBodies ?? {})) applyBlocks(body);
  for (const body of Object.values(doc.footnotes ?? {})) applyBlocks(body);
  for (const body of Object.values(doc.endnotes ?? {})) applyBlocks(body);
  for (const c of Object.values(doc.comments ?? {})) applyBlocks(c.body);

  for (const style of doc.styles) {
    apply(style.runDefaults);
    apply(style.paragraphDefaults?.runDefaults);
  }
}
