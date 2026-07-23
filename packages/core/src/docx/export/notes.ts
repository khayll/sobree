/**
 * Emit `word/footnotes.xml`, `word/comments.xml` and
 * `word/commentsExtended.xml` — the inverse of `import/footnotes.ts` /
 * `import/comments.ts`. Bodies serialize through the shared
 * `renderBlocks`, so anything a body paragraph can hold round-trips the
 * same way document paragraphs do.
 *
 * Reference marks in the BODY (`<w:footnoteReference>`,
 * `<w:commentRangeStart/End>`, `<w:commentReference>`) are emitted by
 * `runs.ts`, not here — this module owns only the note parts.
 */

import type { Comment, SobreeDocument } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { el, xmlDocument } from "../shared/xml";
import type { ExportContext } from "./context";
import { renderBlocks } from "./document";

/** Namespace for Word 2013+ extensions (`commentsExtended.xml`). */
const NS_W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
/** Namespace for Word 2010+ paragraph ids (`w14:paraId`). */
const NS_W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

const FOOTNOTES_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml";
const COMMENTS_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_EXTENDED_CT = "application/vnd.ms-word.commentsExtended+xml";

/**
 * Stage `word/footnotes.xml` when the document has footnotes. Emits the
 * two stock notes Word expects first — `separator` (id −1) and
 * `continuationSeparator` (id 0), whose bodies are the standard
 * separator-rule runs — then one `<w:footnote>` per body, ids ascending.
 * The importer skips the stock notes and ids < 1, so the round-trip sees
 * exactly the real notes.
 */
export function emitFootnotesPart(doc: SobreeDocument, ctx: ExportContext): void {
  const entries = Object.entries(doc.footnotes ?? {});
  if (entries.length === 0) return;

  const stock = [
    el(
      "w:footnote",
      { "w:type": "separator", "w:id": -1 },
      el("w:p", null, el("w:r", null, el("w:separator"))),
    ),
    el(
      "w:footnote",
      { "w:type": "continuationSeparator", "w:id": 0 },
      el("w:p", null, el("w:r", null, el("w:continuationSeparator"))),
    ),
  ];
  const notes = entries
    .map(([id, blocks]) => ({ id: Number(id), blocks }))
    .sort((a, b) => a.id - b.id)
    .map(({ id, blocks }) => el("w:footnote", { "w:id": id }, renderBlocks(blocks, ctx, doc)));

  ctx.parts["word/footnotes.xml"] = xmlDocument(
    el("w:footnotes", { "xmlns:w": NS.w, "xmlns:r": NS.r }, [...stock, ...notes]),
  );
  ctx.contentTypeOverrides.push({
    partName: "/word/footnotes.xml",
    contentType: FOOTNOTES_CT,
  });
  ctx.relationships.push({
    id: `rId${ctx.nextRid++}`,
    type: "footnotes",
    target: "footnotes.xml",
  });
}

/**
 * Stage `word/comments.xml` (+ `word/commentsExtended.xml` when any
 * comment carries `done` / `replyToId`) when the document has comments.
 *
 * The extensions file keys off each comment's first body paragraph's
 * `w14:paraId` — an id the AST deliberately doesn't model (it's a wire
 * detail). We synthesize one per comment, deterministic from the comment
 * id, stamp it onto the first `<w:p>` of the body, and mirror the
 * import-side join (`paraIdParent` → parent comment's paraId) in
 * reverse. The fixpoint holds because import only keeps the JOIN result
 * (`done` / `replyToId`), never the paraIds themselves.
 */
export function emitCommentsParts(doc: SobreeDocument, ctx: ExportContext): void {
  const comments = Object.values(doc.comments ?? {}).sort((a, b) => a.id - b.id);
  if (comments.length === 0) return;

  const commentXmls = comments.map((c) => {
    const attrs: Record<string, string | number> = { "w:id": c.id };
    if (c.author !== undefined) attrs["w:author"] = c.author;
    if (c.initials !== undefined) attrs["w:initials"] = c.initials;
    if (c.date !== undefined) attrs["w:date"] = c.date;
    const body = renderBlocks(c.body, ctx, doc);
    if (body.length === 0) body.push(el("w:p"));
    // Stamp the synthesized paraId on the FIRST body paragraph — the
    // extensions join key. String surgery on the serialized paragraph is
    // deliberate: threading a per-paragraph attribute option through the
    // shared renderBlocks for this one wire detail would put a comments
    // concern into every caller's signature. The lookahead covers both
    // paragraph shapes the serializer produces: `<w:p>…` and the
    // self-closed `<w:p/>` of an empty body.
    body[0] = body[0]!.replace(/^<w:p(?=[\s/>])/, `<w:p w14:paraId="${paraIdOf(c.id)}"`);
    return el("w:comment", attrs, body);
  });

  ctx.parts["word/comments.xml"] = xmlDocument(
    el("w:comments", { "xmlns:w": NS.w, "xmlns:r": NS.r, "xmlns:w14": NS_W14 }, commentXmls),
  );
  ctx.contentTypeOverrides.push({
    partName: "/word/comments.xml",
    contentType: COMMENTS_CT,
  });
  ctx.relationships.push({
    id: `rId${ctx.nextRid++}`,
    type: "comments",
    target: "comments.xml",
  });

  emitCommentsExtendedPart(comments, ctx);
}

/** The extensions part — only when some comment actually needs it. */
function emitCommentsExtendedPart(comments: readonly Comment[], ctx: ExportContext): void {
  const needing = comments.filter((c) => c.done || c.replyToId !== undefined);
  if (needing.length === 0) return;

  const exts = needing.map((c) => {
    const attrs: Record<string, string | number> = { "w15:paraId": paraIdOf(c.id) };
    if (c.replyToId !== undefined) attrs["w15:paraIdParent"] = paraIdOf(c.replyToId);
    if (c.done) attrs["w15:done"] = 1;
    return el("w15:commentEx", attrs);
  });

  ctx.parts["word/commentsExtended.xml"] = xmlDocument(
    el("w15:commentsEx", { "xmlns:w15": NS_W15 }, exts),
  );
  ctx.contentTypeOverrides.push({
    partName: "/word/commentsExtended.xml",
    contentType: COMMENTS_EXTENDED_CT,
  });
  ctx.relationships.push({
    id: `rId${ctx.nextRid++}`,
    type: "commentsExtended",
    target: "commentsExtended.xml",
  });
}

/**
 * Deterministic 8-hex-digit `paraId` for a comment id. Word requires a
 * non-zero value below 0x80000000; offsetting into a fixed band keeps
 * every synthesized id valid, unique per comment, and stable across
 * exports (so re-saving an unchanged doc emits identical XML).
 */
function paraIdOf(commentId: number): string {
  return (0x10000000 + commentId).toString(16).toUpperCase().padStart(8, "0");
}
