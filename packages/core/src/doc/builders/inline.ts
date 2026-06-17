/**
 * Inline-run builders — everything that lives inside a paragraph's `runs`
 * (or a hyperlink's `children`): text, breaks, tabs, links, fields,
 * images, and footnote / comment references.
 */

import type {
  BreakRun,
  CommentRefRun,
  DrawingRun,
  FieldRun,
  FootnoteRefRun,
  HyperlinkRun,
  InlineRun,
  RunProperties,
  TabRun,
  TextRun,
} from "../types";

/** Plain text run with optional formatting. */
export function text(value: string, properties: RunProperties = {}): TextRun {
  return { kind: "text", text: value, properties };
}

/** Convenience: italic text run. */
export function emphasis(value: string, properties: RunProperties = {}): TextRun {
  return { kind: "text", text: value, properties: { ...properties, italic: true } };
}

/** Convenience: bold text run. */
export function strong(value: string, properties: RunProperties = {}): TextRun {
  return { kind: "text", text: value, properties: { ...properties, bold: true } };
}

/** Soft line break inside a paragraph (Shift-Enter). */
export function softBreak(): BreakRun {
  return { kind: "break", type: "line" };
}

/** Explicit page break. */
export function pageBreak(): BreakRun {
  return { kind: "break", type: "page" };
}

/** Column break (advances to the next column in a multi-column section). */
export function columnBreak(): BreakRun {
  return { kind: "break", type: "column" };
}

/** A tab character — advances to the next tab stop. */
export function tab(properties: RunProperties = {}): TabRun {
  return { kind: "tab", properties };
}

/** A hyperlink wrapping inline children. `href` is an external URL or an
 *  internal anchor id (`#bookmark`). */
export function hyperlink(
  href: string,
  children: InlineRun[],
  properties: RunProperties = {},
): HyperlinkRun {
  return { kind: "hyperlink", href, children, properties };
}

/** A field run (`PAGE`, `NUMPAGES`, `DATE`, …). `cached` is the preview
 *  text shown until a viewer recalculates the field. */
export function field(
  instruction: string,
  cached?: string,
  properties: RunProperties = {},
): FieldRun {
  return {
    kind: "field",
    instruction,
    ...(cached !== undefined ? { cached } : {}),
    properties,
  };
}

/** Options for {@link image}. `partPath` references a binary in the
 *  document's `rawParts`; the caller is responsible for registering the
 *  bytes there (or use the editor's `insertImage`, which does both). */
export interface ImageOptions {
  widthEmu: number;
  heightEmu: number;
  altText?: string;
  /** Layout mode — defaults to `"inline"` (flows like a tall character). */
  placement?: DrawingRun["placement"];
  verticalAlign?: DrawingRun["verticalAlign"];
}

/** An image / drawing run referencing a part in `rawParts`. */
export function image(partPath: string, opts: ImageOptions): DrawingRun {
  return {
    kind: "drawing",
    partPath,
    widthEmu: opts.widthEmu,
    heightEmu: opts.heightEmu,
    placement: opts.placement ?? "inline",
    ...(opts.altText !== undefined ? { altText: opts.altText } : {}),
    ...(opts.verticalAlign !== undefined ? { verticalAlign: opts.verticalAlign } : {}),
  };
}

/** A footnote reference — `id` keys into `SobreeDocument.footnotes`. */
export function footnoteRef(id: number, properties: RunProperties = {}): FootnoteRefRun {
  return { kind: "footnoteRef", id, properties };
}

/** A comment reference — `id` keys into `SobreeDocument.comments`. */
export function commentRef(id: number, properties: RunProperties = {}): CommentRefRun {
  return { kind: "commentRef", id, properties };
}
