import { renderBlocks } from "./block";
import type { SobreeDocument } from "../../../doc/types";

/**
 * Walk a SobreeDocument's body into `host`, replacing its existing
 * children. List grouping, heading style mapping, and image resolution
 * live downstream in `block.ts` / `inline.ts`.
 *
 * Footnotes (when present) render as an `<aside class="sobree-footnotes">`
 * appended *after* the body content. True per-page pinning of footnotes
 * is a paginator feature deferred until a fixture demands it; for now
 * the references in body text link to footnote bodies at the doc end.
 *
 * Comments are NOT rendered here — core only emits the neutral inline
 * `<span class="sobree-comment-range">` marks (in `inline.ts`). The
 * `@sobree/review` plugin reads those marks + `doc.comments` to render
 * the comment cards. Without the plugin, commented text is still
 * highlighted; there's just no card surface.
 */
export function renderSobreeDocument(
  doc: SobreeDocument,
  host: HTMLElement,
  blockIds?: readonly string[],
): void {
  host.replaceChildren();
  // Per-document layout settings: stamp `<w:defaultTabStop>` as a CSS
  // variable on the host so every paragraph inherits Word's tab
  // geometry by default (paragraphs that declare their own `<w:tabs>`
  // still override via inline `tab-size` set in `applyParagraphProps`).
  // Falls back to Word's factory default 720 twips (0.5") when the
  // doc's settings.xml omits the element.
  applyDefaultTabStop(host, doc.settings?.defaultTabStopTwips ?? 720);
  renderBlocks(doc.body, host, doc.numbering, doc.styles, doc.rawParts, blockIds, doc.sections);
  if (doc.footnotes && Object.keys(doc.footnotes).length > 0) {
    renderFootnotesAside(doc, host);
  }
}

function applyDefaultTabStop(host: HTMLElement, tabStopTwips: number): void {
  // twips → mm: 1 inch = 25.4 mm = 1440 twips.
  const mm = (tabStopTwips / 1440) * 25.4;
  // Set on the editor root (or paper-stack root, or `host` itself as
  // fallback) so the value reaches BOTH `.paper-content` descendants
  // AND `.paper-header` / `.paper-footer` siblings (which sit outside
  // host but inside the same editor scope). Without walking up, the
  // tab-size only inherits into body paragraphs and header tabs revert
  // to the browser's 8-char default.
  let scope: HTMLElement | null = host;
  while (
    scope &&
    !scope.classList.contains("sobree-editor") &&
    !scope.classList.contains("paper-stack")
  ) {
    scope = scope.parentElement;
  }
  const target = scope ?? host;
  target.style.setProperty("tab-size", `${mm}mm`);
  target.style.setProperty("-moz-tab-size", `${mm}mm`);
}

function renderFootnotesAside(doc: SobreeDocument, host: HTMLElement): void {
  const aside = document.createElement("aside");
  aside.className = "sobree-footnotes";
  aside.setAttribute("role", "doc-endnotes");
  const list = document.createElement("ol");
  list.className = "sobree-footnotes__list";
  const ids = Object.keys(doc.footnotes!)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  for (const id of ids) {
    const li = document.createElement("li");
    li.id = `sobree-footnote-${id}`;
    li.value = id;
    li.className = "sobree-footnotes__item";
    renderBlocks(doc.footnotes![id]!, li, doc.numbering, doc.styles, doc.rawParts);
    list.appendChild(li);
  }
  aside.appendChild(list);
  host.appendChild(aside);
}
