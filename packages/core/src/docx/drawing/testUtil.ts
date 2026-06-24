/**
 * Test-only helper: parse a single namespaced DrawingML fragment and
 * return its root element, with all the OOXML prefixes the concept
 * readers expect already declared. Keeps the per-concept `.test.ts`
 * files free of namespace boilerplate.
 */

const NS_ATTRS = [
  `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`,
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`,
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`,
  `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`,
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`,
  `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`,
  `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"`,
].join(" ");

/** Parse `<prefix:tag …>…</…>` and return the root element. The namespace
 *  declarations are injected onto the root so any prefix resolves. */
export function el(fragment: string): Element {
  const closeIdx = fragment.indexOf(">");
  const selfClosing = fragment.slice(0, closeIdx + 1).endsWith("/>");
  const insertAt = selfClosing ? closeIdx - 1 : closeIdx;
  const withNs = `${fragment.slice(0, insertAt)} ${NS_ATTRS}${fragment.slice(insertAt)}`;
  const doc = new DOMParser().parseFromString(withNs, "application/xml");
  return doc.documentElement;
}
