import type { BlockTarget } from "../blockKinds";
import { icon } from "./icons";
import type { BlockRef } from "@sobree/core";
import type {
  Block,
  NumberingDefinition,
  Paragraph,
  SobreeDocument,
  Table,
} from "@sobree/core";
import type { Editor } from "@sobree/core";

export interface ChangeTypeContext {
  editor: Editor;
  target: BlockTarget;
  /** Blocks the operation should apply to (1 for single, N for multi). */
  refs: BlockRef[];
}

/**
 * Drill-down target kinds. Kept deliberately short — exotic targets
 * (images, nested tables) land as "convert current to" with a caveat
 * that the existing content is wrapped into the new structure.
 */
type TargetKind =
  | { kind: "paragraph" }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "quote" }
  | { kind: "bullet" }
  | { kind: "ordered" }
  | { kind: "table" }
  | { kind: "section_break" };

/**
 * Build the "Change block type" trigger — rendered at the end of the
 * primary toolbar row. Label adapts to single vs multi-block.
 */
export function buildChangeTypeButton(refCount: number): string {
  const label = refCount > 1 ? `Convert ${refCount} blocks` : "Change block";
  return `
    <div class="tb-divider"></div>
    <div class="tb-group" data-group="change-type">
      <button type="button" class="tb-change-btn" data-action="open-change-type"
        title="${label}" aria-label="${label}"
        aria-haspopup="menu" aria-expanded="false">
        ${icon("chevron-down")} ${label}
      </button>
    </div>
  `;
}

/**
 * Open a popover next to the trigger button with target-kind options.
 * Uses the same `FloatingToolbar` element as an anchor reference so the
 * popover sits just below it.
 *
 * Returns a `close()` handle so callers can dismiss the popover when
 * the toolbar closes.
 */
export function openChangeTypePopover(
  trigger: HTMLElement,
  ctx: ChangeTypeContext,
  onClose: () => void,
): () => void {
  const currentKey = currentTargetKey(ctx);
  const popover = document.createElement("div");
  popover.className = "sobree-change-popover";
  popover.setAttribute("role", "menu");
  popover.setAttribute("aria-label", "Change block type");
  popover.tabIndex = -1; // accept focus so keyboard navigation works
  popover.innerHTML = buildPopoverHtml(ctx.refs.length, currentKey);
  document.body.appendChild(popover);

  // Position just below the trigger, aligned to its right edge so the
  // menu opens into the free space to the right of the button.
  const triggerRect = trigger.getBoundingClientRect();
  popover.style.top = `${triggerRect.bottom + 6}px`;
  popover.style.left = `${Math.max(8, triggerRect.left)}px`;
  const items = () =>
    Array.from(
      popover.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"], button[role="menuitemradio"]',
      ),
    );

  // Next tick: fade in + focus the first item so Down/Enter work right
  // away from a keyboard.
  requestAnimationFrame(() => {
    popover.classList.add("is-open");
    items()[0]?.focus();
  });

  const close = () => {
    popover.classList.remove("is-open");
    // Let the fade run before removing.
    window.setTimeout(() => popover.remove(), 180);
    document.removeEventListener("mousedown", onDocDown, true);
    onClose();
  };

  const onDocDown = (e: MouseEvent) => {
    if (popover.contains(e.target as Node)) return;
    if (trigger.contains(e.target as Node)) return;
    close();
  };

  popover.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest("[data-target-kind]");
    if (!item) return;
    const raw = item.getAttribute("data-target-kind");
    if (!raw) return;
    const target = parseTarget(raw);
    if (target) applyTarget(ctx, target);
    close();
  });

  // Standard menu keyboard model — ArrowDown/Up move between items,
  // Home/End jump to the ends, Enter activates, Esc closes.
  popover.addEventListener("keydown", (e) => {
    const all = items();
    const idx = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      all[(idx + 1) % all.length]?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      all[(idx - 1 + all.length) % all.length]?.focus();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      all[0]?.focus();
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      all[all.length - 1]?.focus();
      return;
    }
  });

  document.addEventListener("mousedown", onDocDown, true);

  return close;
}

function buildPopoverHtml(refCount: number, currentKey: string | null): string {
  const multi = refCount > 1;
  const item = (key: string, label: string): string => {
    const isCurrent = !multi && currentKey === key;
    const cls = isCurrent ? ' class="is-current"' : "";
    const aria = isCurrent ? ' aria-checked="true"' : ' aria-checked="false"';
    return `<button type="button" role="menuitemradio"${aria}${cls} data-target-kind="${key}">${label}</button>`;
  };
  const convertGroup = `
    <div class="popover-section">
      <div class="popover-label">Convert to</div>
      ${item("paragraph", `${iconInline("type")} Paragraph`)}
      ${item("heading:1", "H1 &nbsp;Heading 1")}
      ${item("heading:2", "H2 &nbsp;Heading 2")}
      ${item("heading:3", "H3 &nbsp;Heading 3")}
      ${item("heading:4", "H4 &nbsp;Heading 4")}
      ${item("quote", `${iconInline("code")} Quote`)}
      ${item("bullet", `${iconInline("list-bullet")} Bullet list`)}
      ${item("ordered", `${iconInline("list-numbered")} Numbered list`)}
    </div>
  `;
  // Structural conversions (wrap content into a new structure) only make
  // sense for single-block selections. These are not "current"-able —
  // section break is "insert after", table is destructive replace.
  const structuralGroup = multi
    ? ""
    : `
    <div class="popover-divider"></div>
    <div class="popover-section">
      <div class="popover-label">Replace with</div>
      <button type="button" role="menuitem" data-target-kind="table">Table (3×3)</button>
    </div>
    <div class="popover-section">
      <div class="popover-label">Insert after</div>
      <button type="button" role="menuitem" data-target-kind="section_break" title="Ctrl/Cmd + Shift + Enter">Section break</button>
    </div>
  `;
  return convertGroup + structuralGroup;
}

/**
 * Resolve the current block kind into one of the popover's `data-target-kind`
 * keys, so the matching item can be highlighted as "current". Returns null
 * if the current kind has no equivalent in the menu (table, section_break,
 * image, multi-block, …).
 */
function currentTargetKey(ctx: ChangeTypeContext): string | null {
  if (ctx.refs.length !== 1) return null;
  const first = ctx.refs[0];
  if (!first) return null;
  // Defensive — minimal stubs in tests may not implement every method.
  if (
    typeof ctx.editor.getBlockById !== "function" ||
    typeof ctx.editor.getDocument !== "function"
  ) {
    return null;
  }
  const info = ctx.editor.getBlockById(first.id);
  if (!info || info.kind !== "paragraph") return null;
  const doc = ctx.editor.getDocument();
  const block = doc.body[info.index];
  if (!block || block.kind !== "paragraph") return null;
  if (block.properties.numbering) {
    const numId = block.properties.numbering.numId;
    const def = doc.numbering.find((n) => n.numId === numId);
    const fmt = def?.abstractFormat.levels[0]?.format;
    if (fmt === "bullet") return "bullet";
    if (fmt === "decimal") return "ordered";
    return "bullet"; // fallback for unknown list formats
  }
  const styleId = block.properties.styleId;
  if (!styleId || styleId === "Normal") return "paragraph";
  if (styleId === "Quote") return "quote";
  const m = styleId.match(/^Heading([1-6])$/);
  if (m) return `heading:${m[1]}`;
  return null;
}

function iconInline(name: string): string {
  return icon(name as Parameters<typeof icon>[0]);
}

function parseTarget(raw: string): TargetKind | null {
  if (raw === "paragraph") return { kind: "paragraph" };
  if (raw === "quote") return { kind: "quote" };
  if (raw === "bullet") return { kind: "bullet" };
  if (raw === "ordered") return { kind: "ordered" };
  if (raw === "table") return { kind: "table" };
  if (raw === "section_break") return { kind: "section_break" };
  const m = raw.match(/^heading:([1-6])$/);
  if (m?.[1]) {
    const lv = Number(m[1]) as 1 | 2 | 3 | 4 | 5 | 6;
    return { kind: "heading", level: lv };
  }
  return null;
}

function applyTarget(ctx: ChangeTypeContext, target: TargetKind): void {
  if (target.kind === "table") {
    convertToTable(ctx);
    return;
  }
  if (target.kind === "section_break") {
    // Section break is "insert after current block" — same dispatch
    // path as Ctrl+Shift+Enter, so behaviour is consistent.
    ctx.editor.commands.execute("section.insertBreakAfter");
    return;
  }
  // Convert-in-place: swap styleId + numbering as appropriate.
  for (const ref of ctx.refs) {
    applyConversion(ctx.editor, ref, target);
  }
}

function applyConversion(
  editor: Editor,
  ref: BlockRef,
  target: TargetKind,
): void {
  const info = editor.getBlockById(ref.id);
  if (!info) return;

  // Convert-from-table: collapse the table into a single paragraph
  // carrying the concatenated text of every cell. The block id and
  // index stay stable, so the subsequent property/numbering work
  // applies normally.
  if (info.kind === "table") {
    flattenTableToParagraph(editor, ref);
    // Re-resolve — replaceBlock bumped the version.
    const refreshed = editor.getBlockById(ref.id);
    if (!refreshed) return;
    ref = { id: refreshed.id, version: refreshed.version };
  } else if (info.kind !== "paragraph") {
    // section_break / image: nothing meaningful to convert. The
    // popover shouldn't have been reachable for these kinds anyway.
    return;
  }

  if (target.kind === "paragraph") {
    editor.applyBlockProperties([ref], { styleId: undefined, numbering: undefined });
    return;
  }
  if (target.kind === "heading") {
    editor.applyBlockProperties([ref], {
      styleId: `Heading${target.level}`,
      numbering: undefined,
    });
    return;
  }
  if (target.kind === "quote") {
    editor.applyBlockProperties([ref], { styleId: "Quote", numbering: undefined });
    return;
  }
  if (target.kind === "bullet" || target.kind === "ordered") {
    // Convert-to-list needs a numbering definition. Reuse an existing
    // one with the right format if present, else add one in a single
    // setDocument pass.
    convertBlockToList(editor, ref, target.kind === "bullet" ? "bullet" : "decimal");
    return;
  }
}

/**
 * Replace a `Table` block with a `Paragraph` carrying the concatenated
 * text of every cell, separated by spaces. Cells with formatting are
 * flattened to plain text — the round-trip story is "convert is
 * destructive for tables".
 */
function flattenTableToParagraph(editor: Editor, ref: BlockRef): void {
  const doc = editor.getDocument();
  const info = editor.getBlockById(ref.id);
  if (!info) return;
  const block = doc.body[info.index];
  if (!block || block.kind !== "table") return;

  const parts: string[] = [];
  for (const row of block.rows) {
    for (const cell of row.cells) {
      for (const inner of cell.content) {
        if (inner.kind !== "paragraph") continue;
        for (const run of inner.runs) {
          if (run.kind === "text" && run.text) parts.push(run.text);
        }
      }
    }
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  const next: Paragraph = {
    kind: "paragraph",
    properties: {},
    runs: text ? [{ kind: "text", text, properties: {} }] : [],
  };
  editor.replaceBlock(ref, next);
}

function convertBlockToList(
  editor: Editor,
  ref: BlockRef,
  format: "bullet" | "decimal",
): void {
  const doc = editor.getDocument();
  const info = editor.getBlockById(ref.id);
  if (!info) return;
  const block = doc.body[info.index];
  if (!block || block.kind !== "paragraph") return;

  const existing = doc.numbering.find(
    (n) => n.abstractFormat.levels[0]?.format === format,
  );
  let numId: number;
  let nextNumbering: NumberingDefinition[] = doc.numbering;
  if (existing) {
    numId = existing.numId;
  } else {
    numId = doc.numbering.reduce((n, d) => Math.max(n, d.numId), 0) + 1;
    nextNumbering = [
      ...doc.numbering,
      {
        numId,
        abstractFormat: {
          levels: [
            {
              level: 0,
              format,
              text: format === "bullet" ? "\u2022" : "%1.",
            },
          ],
        },
      },
    ];
  }

  // Drop any heading / quote style when becoming a list item — omit the
  // key rather than assigning `undefined` so the shape satisfies
  // `exactOptionalPropertyTypes`.
  const { styleId: _omit, ...cleanProps } = block.properties;
  void _omit;
  const nextBlock: Paragraph = {
    ...block,
    properties: {
      ...cleanProps,
      numbering: { numId, level: 0 },
    },
  };
  const nextBody = doc.body.slice();
  nextBody[info.index] = nextBlock;
  const nextDoc: SobreeDocument = {
    ...doc,
    body: nextBody,
    numbering: nextNumbering,
  };
  editor.setDocument(nextDoc);
}

/**
 * Replace the current paragraph with a 3×3 table. If the paragraph has
 * text, seed the first cell with it; the other 8 cells are empty.
 */
function convertToTable(ctx: ChangeTypeContext): void {
  const ref = ctx.refs[0];
  if (!ref) return;
  const info = ctx.editor.getBlockById(ref.id);
  if (!info) return;
  const doc = ctx.editor.getDocument();
  const block = doc.body[info.index];
  if (!block || block.kind !== "paragraph") return;

  const empty = () => ({
    content: [{ kind: "paragraph", properties: {}, runs: [] } as Paragraph] as Block[],
  });
  const withExistingRuns = {
    content: [{ kind: "paragraph", properties: {}, runs: block.runs } as Paragraph] as Block[],
  };

  const table: Table = {
    kind: "table",
    grid: [2400, 2400, 2400],
    rows: [
      { cells: [withExistingRuns, empty(), empty()] },
      { cells: [empty(), empty(), empty()] },
      { cells: [empty(), empty(), empty()] },
    ],
    properties: {},
  };
  ctx.editor.replaceBlock(ref, table);
}
