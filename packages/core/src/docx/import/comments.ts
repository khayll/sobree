/**
 * Parse `word/comments.xml` into a map of `id → Comment`.
 *
 * OOXML structure:
 *
 *   <w:comments>
 *     <w:comment w:id="0" w:author="Alice" w:date="..." w:initials="A">
 *       <w:p><w:r><w:t>Body…</w:t></w:r></w:p>
 *     </w:comment>
 *     <w:comment w:id="1" w:author="Bob">…</w:comment>
 *   </w:comments>
 *
 * Each comment's body is converted with the standard paragraph /
 * table walkers — comment bodies are just small block streams.
 */

import type { Block, Comment } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { parseXml, wAll } from "../shared/xml";
import { type ConvertContext, convertParagraph } from "./paragraph";
import { convertTable } from "./tables";

/** Namespace for Word 2013+ extensions (`commentsExtended.xml`). */
const NS_W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
/** Namespace for Word 2010+ paragraph ids (`paraId`). */
const NS_W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

export function parseCommentsXml(
  xml: string | undefined,
  ctx: ConvertContext,
  extendedXml?: string | undefined,
): Record<number, Comment> {
  if (!xml) return {};
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return {};
  }
  // Pre-parse the extensions file (Word 2013+ adds `done` / parent on
  // each `commentEx`, keyed by the body paragraph's `w14:paraId`).
  const ext = extendedXml ? parseCommentsExtendedXml(extendedXml) : new Map<string, CommentExt>();

  // First pass: parse each `<w:comment>` body. Capture the first
  // paragraph's `w14:paraId` so the extensions (keyed by that id) can
  // attach `done` / `replyToId` later. Build a `paraId → commentId`
  // map alongside so we can resolve `paraIdParent` references.
  const out: Record<number, Comment> = {};
  const paraIdToCommentId = new Map<string, number>();
  const commentIdToFirstParaId = new Map<number, string>();
  for (const comment of wAll(doc, "comment")) {
    const idAttr = comment.getAttributeNS(NS.w, "id") ?? comment.getAttribute("w:id");
    const id = Number(idAttr);
    if (!Number.isFinite(id) || id < 0) continue;

    const body: Block[] = [];
    let firstParaId: string | null = null;
    for (const child of Array.from(comment.children)) {
      if (child.namespaceURI !== NS.w) continue;
      if (child.localName === "p") {
        if (firstParaId === null) {
          firstParaId = child.getAttributeNS(NS_W14, "paraId") ?? child.getAttribute("w14:paraId");
        }
        body.push(convertParagraph(child, ctx));
      } else if (child.localName === "tbl") {
        body.push(convertTable(child, ctx));
      }
    }
    if (firstParaId !== null) {
      paraIdToCommentId.set(firstParaId, id);
      commentIdToFirstParaId.set(id, firstParaId);
    }

    const author = comment.getAttributeNS(NS.w, "author") ?? comment.getAttribute("w:author");
    const initials = comment.getAttributeNS(NS.w, "initials") ?? comment.getAttribute("w:initials");
    const date = comment.getAttributeNS(NS.w, "date") ?? comment.getAttribute("w:date");
    out[id] = {
      id,
      ...(author ? { author } : {}),
      ...(initials ? { initials } : {}),
      ...(date ? { date } : {}),
      body,
    };
  }

  // Second pass: decorate each comment with `done` + `replyToId` from
  // the extensions file, joining via the paraId we recorded.
  for (const [id, comment] of Object.entries(out)) {
    const paraId = commentIdToFirstParaId.get(Number(id));
    if (!paraId) continue;
    const meta = ext.get(paraId);
    if (!meta) continue;
    if (meta.done) comment.done = true;
    if (meta.paraIdParent) {
      const parentId = paraIdToCommentId.get(meta.paraIdParent);
      if (parentId !== undefined && parentId !== Number(id)) {
        comment.replyToId = parentId;
      }
    }
  }
  return out;
}

interface CommentExt {
  done?: true;
  paraIdParent?: string;
}

/**
 * Parse `word/commentsExtended.xml` into a `paraId → { done, paraIdParent }` map.
 *
 *   <w15:commentsEx xmlns:w15="...">
 *     <w15:commentEx w15:paraId="ABCD1234" w15:done="1"/>
 *     <w15:commentEx w15:paraId="EFGH5678" w15:paraIdParent="ABCD1234"/>
 *   </w15:commentsEx>
 *
 *   - `done="1"` → comment was marked resolved in Word.
 *   - `paraIdParent` → this comment is a reply to the comment whose
 *     body's first paragraph has that paraId. The join from paraId to
 *     comment id happens in the caller (the comments file owns the
 *     paraId→commentId mapping).
 */
function parseCommentsExtendedXml(xml: string): Map<string, CommentExt> {
  const out = new Map<string, CommentExt>();
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return out;
  }
  const exs = Array.from(doc.getElementsByTagNameNS(NS_W15, "commentEx"));
  for (const ex of exs) {
    const paraId = ex.getAttributeNS(NS_W15, "paraId") ?? ex.getAttribute("w15:paraId");
    if (!paraId) continue;
    const done = ex.getAttributeNS(NS_W15, "done") ?? ex.getAttribute("w15:done");
    const paraIdParent =
      ex.getAttributeNS(NS_W15, "paraIdParent") ?? ex.getAttribute("w15:paraIdParent");
    const entry: CommentExt = {};
    if (done === "1") entry.done = true;
    if (paraIdParent) entry.paraIdParent = paraIdParent;
    if (entry.done || entry.paraIdParent) out.set(paraId, entry);
  }
  return out;
}
