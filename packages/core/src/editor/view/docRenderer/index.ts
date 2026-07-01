import type { Block, InlineRun, SobreeDocument } from "../../../doc/types";
import { renderBlocks } from "./block";

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
  // Document page background (`<w:background w:color>` gated on
  // `<w:displayBackgroundShape/>`). Stamped as a CSS variable so every
  // `.paper` paints it; unset ⇒ the CSS fallback keeps pages white.
  applyPageBackground(host, doc.settings?.pageBackgroundColor);
  // Body block indices that carry an anchored frame — so an otherwise-empty
  // float-only page (a brochure panel page) is still a valid page break
  // target. See `renderBlocks`' page-break deferral.
  const frameAnchoredIndices = new Set<number>();
  for (const f of doc.anchoredFrames ?? []) {
    if (f.anchor.paragraphIndex !== undefined) frameAnchoredIndices.add(f.anchor.paragraphIndex);
  }
  renderBlocks(
    doc.body,
    host,
    doc.numbering,
    doc.styles,
    doc.rawParts,
    blockIds,
    doc.sections,
    frameAnchoredIndices,
    doc.settings?.noColumnBalance ?? false,
  );
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

function applyPageBackground(host: HTMLElement, color: string | undefined): void {
  // Stamp on the paper-stack / editor scope so every `.paper` inherits the
  // variable. Clear it (rather than leaving a stale value) when the doc has
  // no shown background, so re-rendering a plain doc reverts to white.
  let scope: HTMLElement | null = host;
  while (
    scope &&
    !scope.classList.contains("sobree-editor") &&
    !scope.classList.contains("paper-stack")
  ) {
    scope = scope.parentElement;
  }
  const target = scope ?? host;
  if (color) target.style.setProperty("--page-background", color);
  else target.style.removeProperty("--page-background");
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
  // Footnotes with a custom reference mark carry that mark literally in their
  // body text (Word stores no `<w:footnoteRef>` auto-number element for them),
  // so suppressing the `<ol>` counter avoids a doubled "1. * …" marker.
  const customMarkIds = collectCustomMarkFootnoteIds(doc);
  for (const id of ids) {
    const li = document.createElement("li");
    li.id = `sobree-footnote-${id}`;
    li.value = id;
    li.className = customMarkIds.has(id)
      ? "sobree-footnotes__item sobree-footnotes__item--custom-mark"
      : "sobree-footnotes__item";
    renderBlocks(doc.footnotes![id]!, li, doc.numbering, doc.styles, doc.rawParts);
    list.appendChild(li);
  }
  aside.appendChild(list);
  host.appendChild(aside);
}

/** Footnote ids whose body reference uses a custom mark — collected from the
 *  `FootnoteRefRun`s in body text so the body renderer can suppress its
 *  auto-number for them. */
function collectCustomMarkFootnoteIds(doc: SobreeDocument): Set<number> {
  const ids = new Set<number>();
  const visitRuns = (runs: readonly InlineRun[]): void => {
    for (const r of runs) {
      if (r.kind === "footnoteRef" && r.customMark) ids.add(r.id);
      else if (r.kind === "hyperlink") visitRuns(r.children);
    }
  };
  const visitBlocks = (blocks: readonly Block[]): void => {
    for (const b of blocks) {
      if (b.kind === "paragraph") visitRuns(b.runs);
      else if (b.kind === "table") {
        for (const row of b.rows) for (const cell of row.cells) visitBlocks(cell.content);
      }
    }
  };
  visitBlocks(doc.body);
  return ids;
}
