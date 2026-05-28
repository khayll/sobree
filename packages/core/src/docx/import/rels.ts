import { parseXml } from "../shared/xml";

/**
 * Parse a `_rels/*.rels` file into a map of `Id` → `Target`. The Target is
 * relative to the .rels file's own directory (Word's convention).
 */
export function parseRels(xmlSrc: string): Map<string, string> {
  const out = new Map<string, string>();
  const doc = parseXml(xmlSrc);
  const rels = doc.getElementsByTagName("Relationship");
  for (const r of Array.from(rels)) {
    const id = r.getAttribute("Id");
    const target = r.getAttribute("Target");
    if (id && target) out.set(id, target);
  }
  return out;
}
