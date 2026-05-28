import type { SobreeDocument } from "../../doc/types";

/**
 * Mutable per-export bookkeeping: tracks which image `partPath`s have
 * been allocated rIds, which new parts to add to the ZIP, and which
 * content-type overrides the package manifest needs to declare.
 *
 * Constructed once in `exportDocx`, threaded through document + runs
 * emission, then folded into the final relationships / manifest.
 */
export interface ExportContext {
  /** Next rId to hand out via `allocRel`. Mutated as rIds are allocated. */
  nextRid: number;
  /** Rels to append to `word/_rels/document.xml.rels`. */
  relationships: Array<{
    id: string;
    type: "header" | "footer" | "image" | "hyperlink" | "fontTable";
    target: string;
    /** External targets (URLs) need `TargetMode="External"`. */
    external?: boolean;
  }>;
  /** New ZIP parts to include in the output package (e.g. `word/media/image1.png`). */
  parts: Record<string, Uint8Array | string>;
  /** Content-type overrides to declare in `[Content_Types].xml`. */
  contentTypeOverrides: Array<{ partName: string; contentType: string }>;
  /** Media extensions seen (for content-type Default entries). */
  mediaExtensions: Set<string>;

  /** Cached path → rId so repeated DrawingRuns share one relationship. */
  imageRelByPartPath: Map<string, string>;
  /** Cached href → rId so repeated hyperlinks share one relationship. */
  hyperlinkRelByHref: Map<string, string>;
  /** Running docPr id counter — Word wants unique per-drawing ids. */
  nextDocPrId: number;
  /**
   * Running revision id counter — Word requires `w:id="N"` on each
   * `<w:ins>` / `<w:del>` / `<w:rPrChange>` / paragraph-mark revision
   * element, unique within the document. We share one counter across
   * all revision kinds to keep the IDs simple and contiguous.
   */
  nextRevisionId: number;
}

export function makeExportContext(startRid: number): ExportContext {
  return {
    nextRid: startRid,
    relationships: [],
    parts: {},
    contentTypeOverrides: [],
    mediaExtensions: new Set(),
    imageRelByPartPath: new Map(),
    hyperlinkRelByHref: new Map(),
    nextDocPrId: 1,
    nextRevisionId: 1,
  };
}

/** Allocate the next w:id for a tracked-revision element. */
export function nextRevisionId(ctx: ExportContext): number {
  const n = ctx.nextRevisionId;
  ctx.nextRevisionId += 1;
  return n;
}

/**
 * Ensure an image relationship exists for the given `partPath`. Copies the
 * bytes into `ctx.parts` on first encounter and returns the allocated rId.
 */
export function allocImageRel(
  ctx: ExportContext,
  partPath: string,
  doc: SobreeDocument,
): string | null {
  const cached = ctx.imageRelByPartPath.get(partPath);
  if (cached) return cached;

  const bytes = doc.rawParts[partPath];
  if (!bytes) return null;

  const id = `rId${ctx.nextRid++}`;
  ctx.imageRelByPartPath.set(partPath, id);
  ctx.parts[partPath] = bytes;
  ctx.relationships.push({
    id,
    type: "image",
    target: toWordRelativePath(partPath),
  });
  const ext = partPath.split(".").pop()?.toLowerCase() ?? "";
  if (ext) ctx.mediaExtensions.add(ext);
  return id;
}

function toWordRelativePath(partPath: string): string {
  // Relationships in word/_rels/document.xml.rels are relative to `word/`,
  // so strip that prefix when present.
  if (partPath.startsWith("word/")) return partPath.slice("word/".length);
  return partPath;
}

/** Next unique `docPr id` for a drawing. */
export function nextDocPr(ctx: ExportContext): number {
  return ctx.nextDocPrId++;
}

/**
 * Ensure a hyperlink relationship exists for the given external `href`.
 * Hyperlinks are external-target rels (TargetMode="External"), so the
 * URL itself is the rel's `Target` and no part is added to the ZIP.
 */
export function allocHyperlinkRel(ctx: ExportContext, href: string): string {
  const cached = ctx.hyperlinkRelByHref.get(href);
  if (cached) return cached;
  const id = `rId${ctx.nextRid++}`;
  ctx.hyperlinkRelByHref.set(href, id);
  ctx.relationships.push({ id, type: "hyperlink", target: href, external: true });
  return id;
}
