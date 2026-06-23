/**
 * Y.Doc shape used by Sobree.
 *
 * The document is stored as a Y.Doc — that's the source of truth.
 * `SobreeDocument` is a *projection* of this Y.Doc, computed by the
 * helpers in `./project.ts` and cached by the Editor.
 *
 * # Top-level layout
 *
 * ```
 * ydoc
 * ├── getArray("body")  : Y.Array<Y.Map>     — block list, one Y.Map per block
 * ├── getMap("meta")    : Y.Map              — sections, styles, numbering,
 * │                                            headerFooterBodies, fonts.
 * │                                            Stored as JSON-encoded values
 * │                                            (rarely edited concurrently).
 * │                                            Phase 1c may split fields into
 * │                                            per-key Y types.
 * ├── getMap("parts")    : Y.Map<Uint8Array>  — inline binary parts
 * │                                              (legacy / no-BlobStore path).
 * └── getMap("partRefs") : Y.Map<string>       — partPath → SHA-256 hex hash
 *                                              (Phase 3.2+ / BlobStore path).
 *                                              Bytes live in a side-channel
 *                                              `BlobStore`; the editor's
 *                                              `BlobCache` resolves hashes.
 * ```
 *
 * Both `parts` and `partRefs` coexist — projection unions them so a
 * Y.Doc with inline legacy bytes alongside hash-addressed refs reads
 * correctly. The editor writes to whichever path matches its config
 * (BlobStore → partRefs, otherwise parts).
 *
 * # Block Y.Map shape — paragraphs (Phase 1b.5+)
 *
 * Paragraph blocks (kind === `"paragraph"`, including headings) are
 * structured for char-level CRDT:
 *
 * ```
 * paragraphMap
 * ├── get("id")    : string         — stable block id (matches BlockRegistry)
 * ├── get("kind")  : "paragraph"    — discriminator
 * ├── get("text")  : Y.Text         — runs flatten into here, marks for marks,
 * │                                    embeds for breaks/tabs/fields/drawings,
 * │                                    `link: { href }` mark for hyperlink chars
 * └── get("props") : string (JSON)  — ParagraphProperties (alignment, indent,
 *                                     numbering, …). JSON-encoded for v0.1;
 *                                     concurrent property edits clobber.
 * ```
 *
 * # Block Y.Map shape — non-paragraphs
 *
 * Section breaks stay fully JSON-encoded — no editable inline content:
 *
 * ```
 * sectionBreakMap
 * ├── get("id")    : string             — stable block id
 * └── get("_ast")  : string (JSON)      — JSON-encoded Block
 * ```
 *
 * # Composite blocks — per-part CRDT (Phase 1c)
 *
 * Tables and textbox inline-frames hold nested editable `Block[]`, so
 * their content lives in nested Y structures (not one opaque `_ast`):
 * concurrent edits to *different* cells / frame paragraphs merge, and
 * cell text merges char-level like body paragraphs. The block-Y.Map ↔
 * `Block` mapping is recursive (`./blockCodec.ts`) — a `content` /
 * `body` array holds the same block-Y.Map shape used at the top level.
 *
 * ```
 * tableMap
 * ├── get("id")    : string             — stable block id
 * ├── get("kind")  : "table"            — discriminator
 * ├── get("grid")  : string (JSON)      — number[] column widths (per-table LWW)
 * ├── get("props") : string (JSON)      — TableProperties (per-table LWW)
 * └── get("rows")  : Y.Array<rowMap>
 *       rowMap.get("props")  : string (JSON)  — { isHeader? } (per-row LWW)
 *       rowMap.get("cells")  : Y.Array<cellMap>
 *         cellMap.get("props")   : string (JSON)  — gridSpan/vMerge/shading/… (per-CELL LWW)
 *         cellMap.get("content") : Y.Array<blockMap>  — recurse
 *
 * inlineFrameMap
 * ├── get("id")    : string             — stable block id
 * ├── get("kind")  : "inline_frame"     — discriminator
 * ├── get("_ast")  : string (JSON)      — the frame MINUS textbox.body (geometry/props)
 * └── get("body")  : Y.Array<blockMap>  — textbox body, recurse
 * ```
 *
 * Migration: a pre-Phase-1c table/frame is one whole-block `_ast` (no
 * `rows`/`body` array). Projection reads that fallback; the first edit
 * rebuilds it in the nested shape. Nested content arrays diff
 * positionally (cell content is typically one paragraph); the body
 * array stays id-matched.
 *
 * # Y.Text mark conventions
 *
 * The mapping between Sobree's `RunProperties` and Y.Text marks is
 * 1:1 — `bold: true` becomes `{ bold: true }` on each char's
 * attributes. Two special cases:
 *
 *   - `link: { href }` — chars inside a `HyperlinkRun` carry this mark.
 *     The decoder reconstructs the HyperlinkRun by grouping consecutive
 *     same-href chars.
 *   - Embeds — non-text runs (break / tab / field / drawing) appear as
 *     embed objects (`{ insert: { __sobree: "<kind>", … } }` in delta
 *     form), occupying one position in the Y.Text.
 *
 * See `./runs.ts` for the conversion helpers and `./textDiff.ts` for
 * the smart Y.Text diff that preserves CRDT semantics across applies.
 */

export const Y_BODY_KEY = "body";
export const Y_META_KEY = "meta";
/**
 * Inline binary parts — `Y.Map<string, Uint8Array>` keyed by part
 * path (e.g. `word/media/image1.png`). The legacy path: bytes ride
 * along inside Y updates. Acceptable for small docs; expensive at
 * scale (every peer replicates every byte).
 *
 * Used when no `BlobStore` is configured on the editor.
 */
export const Y_PARTS_KEY = "parts";
/**
 * Content-hashed part references — `Y.Map<string, string>` keyed by
 * part path, valued by SHA-256 hex hash. The Phase 3.2+ path: bytes
 * live in a side-channel `BlobStore`, the Y.Doc carries only small
 * 64-char hashes. Y updates stay tiny regardless of image size.
 *
 * Used when a `BlobStore` is configured. The projection's `rawParts`
 * resolves hashes against the editor's local `BlobCache` (which
 * fetches from the store on miss).
 *
 * Both `parts` and `partRefs` coexist — a Y.Doc can carry inline
 * legacy bytes alongside hash-addressed refs. Projection unions
 * them; mixed-mode swarms work.
 */
export const Y_PARTREFS_KEY = "partRefs";

export const Y_BLOCK_ID_KEY = "id";
/** Discriminator: `"paragraph"` blocks have `text` + `props`; everything
 *  else has `_ast`. Defaults to "_ast" path for forward-compat with
 *  Phase 1a docs that didn't write a kind field. */
export const Y_BLOCK_KIND_KEY = "kind";
/** Phase 1b.5+: Y.Text on paragraph blocks. */
export const Y_BLOCK_TEXT_KEY = "text";
/** Phase 1b.5+: JSON-encoded ParagraphProperties on paragraph blocks. */
export const Y_BLOCK_PROPS_KEY = "props";
/** JSON-encoded Block on leaf non-paragraph blocks (section_break), on
 *  Phase 1a-shaped blocks for backwards compat, and — for inline-frame
 *  composites — the frame MINUS its textbox body (geometry / props). */
export const Y_BLOCK_AST_KEY = "_ast";

// --- Phase 1c composite (table / inline-frame) nested-content keys ---
/** Table: JSON-encoded `number[]` column-width grid. */
export const Y_TABLE_GRID_KEY = "grid";
/** Table: `Y.Array` of row Y.Maps. */
export const Y_TABLE_ROWS_KEY = "rows";
/** Table row: `Y.Array` of cell Y.Maps. */
export const Y_ROW_CELLS_KEY = "cells";
/** Table cell: `Y.Array` of block Y.Maps (the cell's content). */
export const Y_CELL_CONTENT_KEY = "content";
/** Inline-frame textbox: `Y.Array` of block Y.Maps (the frame body). */
export const Y_FRAME_BODY_KEY = "body";

/** Keys stored on the `meta` Y.Map. */
export const Y_META_FIELDS = {
  sections: "sections",
  headerFooterBodies: "headerFooterBodies",
  // Floating layer (absolute-positioned drawings). Persisted alongside the
  // flow content so it survives reload / collab projection — the renderer
  // paints body frames from `anchoredFrames` and per-zone frames from
  // `headerFooterFrames` (keyed by the same partId as `headerFooterBodies`).
  anchoredFrames: "anchoredFrames",
  headerFooterFrames: "headerFooterFrames",
  // Document-side state that also rides only on the projected doc: footnote
  // bodies, comment threads, and doc-level settings. Persisted so they
  // survive reload / collab projection (footnotes/comments would otherwise
  // vanish on refresh, defaultTabStop would revert).
  footnotes: "footnotes",
  comments: "comments",
  settings: "settings",
  styles: "styles",
  numbering: "numbering",
  fonts: "fonts",
} as const;
