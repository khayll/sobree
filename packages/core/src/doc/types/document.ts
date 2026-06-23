// The top-level `SobreeDocument` shape and document-level `Comment`.

import type { FontDeclaration } from "../../fonts/types";
import type { Block } from "./block";
import type { AnchoredFrame, InlineFrame } from "./drawing";
import type { NumberingDefinition } from "./numbering";
import type { SectionProperties } from "./sections";
import type { NamedStyle } from "./styles";

export interface SobreeDocument {
  /** Top-level body content, in document order. */
  body: Block[];
  /**
   * One section per body slice. The simplest doc has exactly one section
   * spanning the whole body. Phase N1 supports a single-section model.
   */
  sections: SectionProperties[];
  /**
   * Header and footer bodies keyed by `HeaderFooterRef.partId`. The partId
   * is the ZIP target name (`header1.xml`, `footer2.xml`, …). Rendering
   * emits each body to its own OOXML part at export time.
   */
  headerFooterBodies: Record<string, Block[]>;
  /**
   * Floating objects that live inside a header/footer part, keyed by the
   * SAME `HeaderFooterRef.partId` as `headerFooterBodies`. A header part
   * is a self-contained sub-document: its flow blocks live in
   * `headerFooterBodies[partId]`, its anchored frames here. The renderer
   * paints these into a per-zone overlay exactly like body `anchoredFrames`.
   * Empty/absent for the common header-without-floats case.
   */
  headerFooterFrames?: Record<string, AnchoredFrame[]>;
  /** Named styles (Heading1, Quote, Body Text, …) defined at the doc level. */
  styles: NamedStyle[];
  /** List/numbering definitions referenced by `Paragraph.properties.numbering`. */
  numbering: NumberingDefinition[];
  /**
   * Embedded binary parts keyed by ZIP path (e.g. `word/media/image1.png`).
   * Images, fonts, custom XML — anything not represented in body XML.
   */
  rawParts: Record<string, Uint8Array>;
  /**
   * Font declarations from `word/fontTable.xml`. Empty for new docs.
   * Embedded faces reference parts inside `rawParts`.
   */
  fonts: FontDeclaration[];
  /**
   * Footnote bodies keyed by id. Body inline runs use `FootnoteRefRun`
   * with the matching `id` to reference them. Empty for docs without
   * footnotes (the common case).
   */
  footnotes?: Record<number, Block[]>;
  /**
   * Comments keyed by id. Body inline runs whose properties carry a
   * matching `commentIds` mark the range each comment annotates.
   * Empty for docs without comments (the common case).
   */
  comments?: Record<number, Comment>;
  /**
   * Document-wide layout settings parsed from `word/settings.xml`.
   * Currently only `defaultTabStopTwips` — Word's default interval for
   * tab advances in paragraphs that don't declare their own `<w:tabs>`
   * stops. Word's factory default is 720 twips (0.5"). Without
   * respecting this, the browser falls back to the CSS `tab-size`
   * default of 8 characters which is much narrower than what Word
   * shows, and tab-aligned content (e.g. label/value columns in
   * letterheads) ends up cramped.
   */
  settings?: {
    defaultTabStopTwips?: number;
  };
  /**
   * NOTE: inline-drawing frames are emitted as `InlineFrame` BLOCKS
   * directly in `body` (the importer splices them in at their source
   * paragraph's position via `ConvertOptions.replaceParagraphs`), so
   * they paginate in document flow. This optional top-level list is
   * a secondary handle kept for tooling/inspection; the renderer
   * consumes the body blocks, not this list.
   *
   * The first-class model replaced the old `liftTextBoxContent`
   * machinery that exploded section-heading textboxes into body
   * paragraphs with synthetic `framePictures` / `liftedFromTextBox`
   * metadata. See `packages/core/docs/INLINE_FRAME_DESIGN.md`.
   */
  inlineFrames?: InlineFrame[];
  /**
   * Floating objects (`<w:drawing>/<wp:anchor>`, `<w:pict>` VML) that
   * live in their own layer above the body. Each frame carries its
   * own coordinates + dimensions in EMU and is independent of
   * pagination — the paginator only sees `body` blocks. The renderer
   * places each frame on the page its anchor resolves to and paints
   * it into a per-page `<div class="paper-anchors">` overlay.
   *
   * Replaces the pre-AnchoredFrame "lifter" architecture where the
   * importer exploded each `<w:txbxContent>` into N body paragraphs
   * with synthetic `liftedFromTextBox` metadata. The flat list here
   * is simpler, makes selection / resize / move trivial (each frame
   * is one DOM element), and frees the paginator from having to
   * route around absolute-positioned ghosts.
   */
  anchoredFrames?: AnchoredFrame[];
}

export interface Comment {
  id: number;
  author?: string;
  /** Author initials as recorded in the docx — Word uses them in the
   *  comment sidebar header. */
  initials?: string;
  /** ISO-8601 date string. */
  date?: string;
  /** Comment body — typically one or more paragraphs. */
  body: Block[];
  /**
   * Resolved / "Done" flag from `word/commentsExtended.xml`
   * (`<w15:commentEx w15:done="1">`). Absent or false → open.
   */
  done?: boolean;
  /**
   * Id of the parent comment when this is a reply in a thread.
   * Resolved from `<w15:commentEx w15:paraIdParent="…">` by matching
   * the parent's body-paragraph paraId back to its comment id.
   * Absent → top-level comment.
   */
  replyToId?: number;
}
