/**
 * OOXML namespace URIs. The spec uses a rich set of prefixes
 * (`w:`, `r:`, `wp:` …); we keep them as constants so both the
 * importer and exporter reference the same strings. Typos here
 * are silent parse failures, so: one source of truth.
 */

export const NS = {
  /** WordprocessingML — the main body namespace. */
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  /** Relationships (images, headers, hyperlinks). */
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  /** DrawingML — image anchors and inline drawings. */
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  /** DrawingML core. */
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  /** Picture (DrawingML). */
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  /** Word-processing shapes (textboxes, geometric primitives). */
  wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
  /** Word-processing groups (containers for shapes / pictures). */
  wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
  /** VML — the legacy `<v:shape>` / `<w:pict>` path Word still emits
   *  for OLE-embedded images and some compatibility shapes. */
  v: "urn:schemas-microsoft-com:vml",
  /** Relationships package part. */
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  /** Content types. */
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
} as const;

/** Minimal attr mapping we emit on `<w:document>` (only the namespaces we use). */
export const ROOT_DOCUMENT_ATTRS: Record<string, string> = {
  "xmlns:w": NS.w,
  "xmlns:r": NS.r,
  "xmlns:wp": NS.wp,
  "xmlns:a": NS.a,
  "xmlns:pic": NS.pic,
};
