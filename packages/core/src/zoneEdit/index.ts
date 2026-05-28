import "./zoneEdit.css";
import type { PageSetup } from "../paperStack/pageSetup";

export type ZoneKind = "header" | "footer";

export interface EnterZoneEditOptions {
  zone: HTMLElement;
  kind: ZoneKind;
  stackRoot: HTMLElement;
  getSetup: () => PageSetup;
  setSetup: (next: PageSetup) => void;
  onExit: () => void;
}

type TemplateSlot = "first" | "last" | "default";

/**
 * Make a header or footer zone editable in place. The displayed (substituted)
 * text is swapped for its template (e.g. "Page {page} of {pages}") so the user
 * edits the template, not its rendered result. On commit (blur, Enter,
 * Escape, click outside, or the caller invoking the returned `finish()`)
 * the new template is written back to the right slot on the PageSetup.
 *
 * The returned function exits zone-edit programmatically — block tools call
 * it when the user clicks the gutter indicator a second time, so the
 * indicator works as a single toggle for entering and leaving the zone.
 */
export function enterZoneEdit(opts: EnterZoneEditOptions): () => void {
  const { zone, kind, stackRoot, getSetup, setSetup, onExit } = opts;

  const slot = resolveTemplateSlot(zone, kind, stackRoot, getSetup());
  const setup = getSetup();
  const template = setup[kind][slot];

  // Zone content: a single editable text node. No in-zone UI islands — those
  // would confuse the browser's caret placement in an empty text node.
  zone.replaceChildren();
  const textNode = document.createTextNode(template);
  zone.appendChild(textNode);
  zone.classList.remove("is-empty");
  stackRoot.classList.add("is-zone-editing");

  // Make the zone the ONLY editable region in the stack. Nested contenteditable
  // makes focus/selection ambiguous: `zone.focus()` can silently fail while the
  // caret stays in whatever was last clicked (e.g. the title). Flipping stack
  // editability off and only zone on leaves one unambiguous target.
  const prevStackEditable = stackRoot.contentEditable;
  stackRoot.contentEditable = "false";
  zone.contentEditable = "true";

  zone.focus();
  placeCursorAtEndOf(textNode);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const newTemplate = (zone.textContent ?? "").replace(/\n+$/, "");
    zone.contentEditable = "false";
    stackRoot.contentEditable = prevStackEditable || "true";
    stackRoot.classList.remove("is-zone-editing");
    zone.removeEventListener("blur", onBlur);
    zone.removeEventListener("keydown", onKey);
    document.removeEventListener("mousedown", onDocMouseDown, true);
    const next = structuredClone(getSetup());
    next[kind][slot] = newTemplate;
    setSetup(next);
    onExit();
  };

  const onBlur = () => finish();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      finish();
    }
  };
  // Any mousedown outside the zone commits — but spare the gutter
  // indicator: BlockTools wants the click to TOGGLE the zone closed,
  // and that path will call `finish()` itself. If we committed here too
  // we'd double-fire and lose the indicator's mousedown semantics.
  const onDocMouseDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (zone.contains(target)) return;
    if (target instanceof Element && target.closest(".sobree-block-indicator")) return;
    finish();
  };

  zone.addEventListener("blur", onBlur);
  zone.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onDocMouseDown, true);

  return finish;
}

function resolveTemplateSlot(
  zone: HTMLElement,
  kind: ZoneKind,
  stackRoot: HTMLElement,
  setup: PageSetup,
): TemplateSlot {
  const papers = Array.from(stackRoot.querySelectorAll(".paper"));
  const paper = zone.closest(".paper") as HTMLElement | null;
  if (!paper) return "default";
  const pageNum = papers.indexOf(paper) + 1;
  const totalPages = papers.length;
  const cfg = setup[kind];
  if (pageNum === 1 && cfg.differentFirst) return "first";
  if (pageNum === totalPages && cfg.differentLast && totalPages > 1) return "last";
  return "default";
}

function placeCursorAtEndOf(node: Text): void {
  const range = document.createRange();
  range.setStart(node, node.length);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
