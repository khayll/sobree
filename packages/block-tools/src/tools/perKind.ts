import type { BlockRef } from "@sobree/core";
import type { Paragraph, SobreeDocument } from "@sobree/core";
import type { Editor } from "@sobree/core";
import type { BlockKind, BlockTarget } from "../blockKinds";
import { icon } from "./icons";
import { readSelectionState } from "./selectionState";

export interface PerKindContext {
  editor: Editor;
  target: BlockTarget;
}

/**
 * Build the kind-specific HTML fragment that follows the shared text
 * tools. Returns an empty string for kinds without extras (e.g. no
 * special UI needed yet).
 *
 * Table tools live in B5 — handled in a dedicated module.
 */
export function buildPerKindHtml(kind: BlockKind): string {
  if (kind === "table") return "";
  if (kind === "header" || kind === "footer") return "";

  const alignment = buildAlignmentHtml();
  const extras: string[] = [alignment];

  if (kind === "heading") extras.push(buildHeadingLevelHtml());
  if (kind === "list" || kind === "listOrdered") extras.push(buildListHtml(kind));
  if (kind === "image") extras.push(buildImageHtml());

  return `<div class="tb-divider"></div>${extras.join('<div class="tb-divider"></div>')}`;
}

/**
 * Wire clicks + input events for the per-kind fragment. Returns a detach
 * function. Safe to call even if `kind` has no extras (noop detach).
 */
export function wirePerKindTools(root: HTMLElement, ctx: PerKindContext): () => void {
  const handlers: Array<() => void> = [];

  const onAlign = (e: Event) => {
    const btn = (e.target as HTMLElement).closest('button[data-action="align"]');
    if (!btn) return;
    const arg = btn.getAttribute("data-arg");
    if (!arg) return;
    const alignment = arg === "justify" ? "both" : arg;
    if (
      alignment !== "left" &&
      alignment !== "center" &&
      alignment !== "right" &&
      alignment !== "both"
    )
      return;
    applyToTargetBlocks(ctx, (ref) => {
      const result = ctx.editor.applyBlockProperties([ref], { alignment });
      warnOnEditFailure("align", result);
    });
  };
  root.addEventListener("click", onAlign);
  handlers.push(() => root.removeEventListener("click", onAlign));

  const onLineSpacing = (e: Event) => {
    const el = e.target as HTMLElement;
    if (el.getAttribute("data-role") !== "line-spacing") return;
    const raw = (el as HTMLSelectElement).value;
    (el as HTMLSelectElement).selectedIndex = 0;
    const mult = Number(raw);
    if (!Number.isFinite(mult) || mult <= 0) return;
    applyToTargetBlocks(ctx, (ref) =>
      ctx.editor.applyBlockProperties([ref], {
        spacing: { line: Math.round(240 * mult), lineRule: "auto" },
      }),
    );
  };
  root.addEventListener("change", onLineSpacing);
  handlers.push(() => root.removeEventListener("change", onLineSpacing));

  if (ctx.target.kind === "heading") {
    const onHeadingLevel = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.getAttribute("data-role") !== "heading-level") return;
      const level = Number((el as HTMLSelectElement).value);
      if (!Number.isFinite(level) || level < 1 || level > 6) return;
      const ref = refForTarget(ctx);
      if (!ref) return;
      ctx.editor.applyBlockProperties([ref], { styleId: `Heading${level}` });
    };
    root.addEventListener("change", onHeadingLevel);
    handlers.push(() => root.removeEventListener("change", onHeadingLevel));
  }

  if (ctx.target.kind === "list" || ctx.target.kind === "listOrdered") {
    const onListAction = (e: Event) => {
      const btn = (e.target as HTMLElement).closest("button[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "toggle-list-kind") toggleListKind(ctx);
      else if (action === "align-list") {
        const arg = btn.getAttribute("data-arg");
        const alignment = arg === "justify" ? "both" : arg;
        if (
          alignment !== "left" &&
          alignment !== "center" &&
          alignment !== "right" &&
          alignment !== "both"
        )
          return;
        applyAlignmentToWholeList(ctx, alignment);
      }
    };
    root.addEventListener("click", onListAction);
    handlers.push(() => root.removeEventListener("click", onListAction));
  }

  if (ctx.target.kind === "image") {
    const onImageInput = (e: Event) => {
      const el = e.target as HTMLElement;
      const role = el.getAttribute("data-role");
      if (role !== "image-alt") return;
      const alt = (el as HTMLInputElement).value;
      updateImageAltAtTarget(ctx, alt);
    };
    root.addEventListener("input", onImageInput);
    handlers.push(() => root.removeEventListener("input", onImageInput));

    const onImageClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest("button[data-action]");
      if (btn?.getAttribute("data-action") === "delete-image") {
        deleteImageAtTarget(ctx);
      }
    };
    root.addEventListener("click", onImageClick);
    handlers.push(() => root.removeEventListener("click", onImageClick));
  }

  // Sync visible state — alignment pressed-state, line-spacing select
  // value, heading level, list-toggle icon. Driven by editor `selection`
  // and `change` events so the toolbar mirrors what's under the caret.
  const syncAll = () => syncPerKindState(root, ctx);
  const detachSelection = ctx.editor.on("selection", syncAll);
  const detachChange = ctx.editor.on("change", syncAll);
  handlers.push(detachSelection, detachChange);
  // Initial paint.
  syncAll();

  return () => {
    for (const detach of handlers) detach();
  };
}

/**
 * Repaint pressed/active/value state on every per-kind control to
 * reflect the current selection. Call from selection / change events
 * and once on toolbar open.
 */
function syncPerKindState(root: HTMLElement, ctx: PerKindContext): void {
  const state = readSelectionState(ctx.editor);

  // Alignment buttons — only one is "pressed" at a time.
  const align = state.paragraphProps?.alignment;
  const arg = align === "both" ? "justify" : align === undefined ? "left" : align;
  const alignBtns = root.querySelectorAll<HTMLButtonElement>('button[data-action="align"]');
  for (const btn of alignBtns) {
    const on = btn.getAttribute("data-arg") === arg;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("is-active", on);
  }

  // Line-spacing select — show the current multiplier (or blank for
  // "default"). The select uses string options like "1.5".
  const lineSel = root.querySelector<HTMLSelectElement>('select[data-role="line-spacing"]');
  if (lineSel) {
    const sp = state.paragraphProps?.spacing;
    if (sp?.line && sp.lineRule === "auto") {
      const mult = sp.line / 240;
      const matched = optionByValue(lineSel, String(mult));
      lineSel.value = matched ?? "";
    } else {
      lineSel.value = "";
    }
  }

  // Heading level — show the current heading number (1..6) or blank.
  const headingSel = root.querySelector<HTMLSelectElement>('select[data-role="heading-level"]');
  if (headingSel) {
    const styleId = state.paragraphProps?.styleId;
    const m = styleId?.match(/^Heading([1-6])$/);
    headingSel.value = m?.[1] ?? "";
  }

  // List toggle — flip the icon to match the current numbering format.
  const listToggle = root.querySelector<HTMLButtonElement>(
    'button[data-action="toggle-list-kind"]',
  );
  if (listToggle) {
    const isOrdered = state.listFormat === "decimal";
    listToggle.innerHTML = icon(isOrdered ? "list-numbered" : "list-bullet");
    listToggle.title = isOrdered ? "Switch to bullet list" : "Switch to numbered list";
  }
}

function optionByValue(sel: HTMLSelectElement, value: string): string | null {
  for (const opt of Array.from(sel.options)) {
    if (opt.value === value) return value;
  }
  return null;
}

// === HTML builders ===

function buildAlignmentHtml(): string {
  return `
    <div class="tb-group" data-group="alignment">
      <button type="button" data-action="align" data-arg="left" title="Align left">${icon("align-left")}</button>
      <button type="button" data-action="align" data-arg="center" title="Align centre">${icon("align-center")}</button>
      <button type="button" data-action="align" data-arg="right" title="Align right">${icon("align-right")}</button>
      <button type="button" data-action="align" data-arg="justify" title="Justify">${icon("align-justify")}</button>
      <select data-role="line-spacing" aria-label="Line spacing" title="Line spacing">
        <option value="">Line</option>
        <option value="1">Single</option>
        <option value="1.15">1.15</option>
        <option value="1.5">1.5</option>
        <option value="2">Double</option>
      </select>
    </div>
  `;
}

function buildHeadingLevelHtml(): string {
  return `
    <div class="tb-group" data-group="heading">
      <select data-role="heading-level" aria-label="Heading level" title="Heading level">
        <option value="">Level</option>
        <option value="1">H1</option>
        <option value="2">H2</option>
        <option value="3">H3</option>
        <option value="4">H4</option>
        <option value="5">H5</option>
        <option value="6">H6</option>
      </select>
    </div>
  `;
}

function buildListHtml(_kind: "list" | "listOrdered"): string {
  // The plain `align` action only affects the focused LI. These
  // `align-list` variants apply the alignment to *every* item in the
  // same list — a one-click way to reformat a whole list without
  // clicking each item.
  return `
    <div class="tb-group" data-group="list">
      <button type="button" data-action="toggle-list-kind" title="Toggle bullet / numbered">${icon("list-numbered")}</button>
      <button type="button" data-action="align-list" data-arg="left" title="Align whole list left">${icon("align-left")}</button>
      <button type="button" data-action="align-list" data-arg="center" title="Align whole list centre">${icon("align-center")}</button>
      <button type="button" data-action="align-list" data-arg="right" title="Align whole list right">${icon("align-right")}</button>
      <button type="button" data-action="align-list" data-arg="justify" title="Justify whole list">${icon("align-justify")}</button>
    </div>
  `;
}

function buildImageHtml(): string {
  return `
    <div class="tb-group" data-group="image">
      <input type="text" data-role="image-alt" placeholder="Alt text" aria-label="Alt text" title="Alt text (screen reader description)" />
      <button type="button" data-action="delete-image" title="Delete image">${icon("trash")}</button>
    </div>
  `;
}

// === action helpers ===

function applyToTargetBlocks(ctx: PerKindContext, fn: (ref: BlockRef) => void): void {
  const ref = refForTarget(ctx);
  if (ref) fn(ref);
}

/**
 * Surface `EditResult` failures from toolbar actions in the console.
 * Editor mutations can fail silently (optimistic-lock conflicts, etc.)
 * if callers don't check the return value — and that's exactly what
 * happened here for months before we noticed: clicking "justify" did
 * nothing and there was no warning. Logging at least makes the next
 * silent failure visible at dev-time.
 */
function warnOnEditFailure(action: string, result: { ok: boolean; error?: unknown }): void {
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[block-tools] ${action} failed:`, result.error);
  }
}

function refForTarget(ctx: PerKindContext): BlockRef | null {
  // Prefer the explicit `target.blockId` — that's the block the toolbar
  // was *opened* on (captured by `blockTargetFrom` from the indicator
  // click). Reading `currentCaret()` here is unreliable because
  // clicking a toolbar button shifts focus, and the browser selection
  // can move off the editor before the action handler fires. In the
  // worst case the caret falls back to `getBlocks()[0]` (the title)
  // and the wrong block silently gets mutated — observed on user-
  // contract: toolbar `align: justify` clicked on a list item went
  // nowhere because `currentCaret()` returned null, then the
  // optimistic-lock guard on `applyBlockProperties` failed silently
  // because version 0 was sent against a current version of N.
  const explicitId = ctx.target.blockId;
  if (explicitId) {
    const info = ctx.editor.getBlockById(explicitId);
    if (info) return { id: info.id, version: info.version };
  }
  const caret = ctx.editor.selection.currentCaret();
  return caret?.block ?? ctx.editor.getBlocks()[0] ?? null;
}

/**
 * Apply `alignment` to every list item that belongs to the same logical
 * list as the toolbar target. "Same list" = a consecutive run of
 * paragraph blocks whose `numbering.numId` matches the target's — the
 * same grouping the renderer uses to fold paragraphs into one `<ol>` /
 * `<ul>`. Blocks outside that run (other lists with a different numId,
 * intervening paragraphs / headings) are left untouched.
 */
function applyAlignmentToWholeList(
  ctx: PerKindContext,
  alignment: "left" | "center" | "right" | "both",
): void {
  const ref = refForTarget(ctx);
  if (!ref) return;
  const info = ctx.editor.getBlockById(ref.id);
  if (!info) return;
  const doc = ctx.editor.getDocument();
  const targetBlock = doc.body[info.index];
  if (!targetBlock || targetBlock.kind !== "paragraph" || !targetBlock.properties.numbering) return;
  const targetNumId = targetBlock.properties.numbering.numId;

  // Walk backward and forward from the target while the numId stays
  // the same. Stop at the first non-matching block on either side.
  let start = info.index;
  while (start > 0) {
    const prev = doc.body[start - 1];
    if (!prev || prev.kind !== "paragraph" || prev.properties.numbering?.numId !== targetNumId)
      break;
    start--;
  }
  let endExclusive = info.index + 1;
  while (endExclusive < doc.body.length) {
    const next = doc.body[endExclusive];
    if (!next || next.kind !== "paragraph" || next.properties.numbering?.numId !== targetNumId)
      break;
    endExclusive++;
  }

  // Collect fresh BlockRefs (id + current version) for every LI in the run.
  // Reading versions live avoids optimistic-lock failures when a recent
  // edit bumped a sibling.
  const refs: BlockRef[] = [];
  for (let i = start; i < endExclusive; i++) {
    const blk = doc.body[i];
    if (!blk) continue;
    const blkInfo = ctx.editor.getBlockById((blk as { id?: string }).id ?? "");
    // The doc body is keyed by index — to get the id, ask the editor.
    const liInfo = ctx.editor.getBlocks()[i];
    if (!liInfo) continue;
    refs.push({ id: liInfo.id, version: liInfo.version });
    void blkInfo;
  }

  const result = ctx.editor.applyBlockProperties(refs, { alignment });
  warnOnEditFailure("align-list", result);
}

/**
 * Flip a list block between bullet and numbered by swapping its numId to
 * another numbering definition with the opposite format.
 *
 * Implemented as a whole-document mutation because list numbering
 * definitions live at the doc level.
 */
function toggleListKind(ctx: PerKindContext): void {
  const ref = refForTarget(ctx);
  if (!ref) return;
  const doc = ctx.editor.getDocument();
  const info = ctx.editor.getBlockById(ref.id);
  if (!info) return;
  const block = doc.body[info.index];
  if (!block || block.kind !== "paragraph" || !block.properties.numbering) return;
  const currentDef = doc.numbering.find((n) => n.numId === block.properties.numbering?.numId);
  if (!currentDef) return;
  const currentFormat = currentDef.abstractFormat.levels[0]?.format ?? "bullet";
  const wantBullet = currentFormat !== "bullet";

  // Build the full next document in one step — both the numbering def
  // (if we need to add one) and the block's reference swap land together
  // in a single `setDocument`, so we don't have to re-resolve block refs
  // between operations.
  const existing = doc.numbering.find(
    (n) => n.abstractFormat.levels[0]?.format === (wantBullet ? "bullet" : "decimal"),
  );
  let targetNumId: number;
  let nextNumbering = doc.numbering;
  if (existing) {
    targetNumId = existing.numId;
  } else {
    targetNumId = doc.numbering.reduce((n, d) => Math.max(n, d.numId), 0) + 1;
    nextNumbering = [
      ...doc.numbering,
      {
        numId: targetNumId,
        abstractFormat: {
          levels: [
            {
              level: 0,
              format: wantBullet ? "bullet" : "decimal",
              text: wantBullet ? "\u2022" : "%1.",
            },
          ],
        },
      },
    ];
  }

  const nextBody = doc.body.slice();
  nextBody[info.index] = {
    ...block,
    properties: {
      ...block.properties,
      numbering: { numId: targetNumId, level: 0 },
    },
  };

  const nextDoc: SobreeDocument = { ...doc, numbering: nextNumbering, body: nextBody };
  ctx.editor.setDocument(nextDoc);
}

function updateImageAltAtTarget(ctx: PerKindContext, alt: string): void {
  // Walk the block's runs, find the first DrawingRun, update its altText.
  const ref = refForTarget(ctx);
  if (!ref) return;
  const doc = ctx.editor.getDocument();
  const info = ctx.editor.getBlockById(ref.id);
  if (!info) return;
  const block = doc.body[info.index];
  if (!block || block.kind !== "paragraph") return;
  const runs = block.runs.map((r) => (r.kind === "drawing" ? { ...r, altText: alt } : r));
  ctx.editor.replaceBlock(ref, { ...block, runs });
}

function deleteImageAtTarget(ctx: PerKindContext): void {
  const ref = refForTarget(ctx);
  if (!ref) return;
  const doc = ctx.editor.getDocument();
  const info = ctx.editor.getBlockById(ref.id);
  if (!info) return;
  const block = doc.body[info.index] as Paragraph | undefined;
  if (!block || block.kind !== "paragraph") return;
  const runs = block.runs.filter((r) => r.kind !== "drawing");
  ctx.editor.replaceBlock(ref, { ...block, runs });
}
