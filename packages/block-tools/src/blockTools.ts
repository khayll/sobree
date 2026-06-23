import "./blockTools.css";
import type { BlockRef } from "@sobree/core";
import { enterZoneEdit } from "@sobree/core";
import type { PageSetup } from "@sobree/core";
import type { Editor } from "@sobree/core";
import type { Viewport } from "@sobree/core";
import type { BlockTarget } from "./blockKinds";
import { BlockIndicator } from "./indicator";
import { FloatingToolbar } from "./toolbar";
import {
  type ChangeTypeContext,
  buildChangeTypeButton,
  openChangeTypePopover,
} from "./tools/changeType";
import { icon } from "./tools/icons";
import { openPageSetupPopover } from "./tools/pageSetup";
import { buildPerKindHtml, wirePerKindTools } from "./tools/perKind";
import {
  type CellLocation,
  type TableMode,
  buildTableToolsHtml,
  locateCellFromSelection,
  wireTableTools,
} from "./tools/table";
import { buildTextToolsHtml, wireTextTools } from "./tools/text";

export interface BlockToolsOptions {
  stackRoot: HTMLElement;
  editor: Editor;
  /** The scrollable area containing the stack (for toolbar positioning). */
  renderingArea: HTMLElement;
  /** Viewport handle — used for animated pans when the toolbar needs room. */
  viewport?: Viewport | null;
  getSetup: () => PageSetup;
  setSetup: (next: PageSetup) => void;
  /**
   * Multi-section setup (optional — defaults to single-section behaviour).
   * When all three are present, the Page setup popover renders a section
   * picker and edits the section the caret is in.
   */
  getSectionCount?: () => number;
  getSectionSetup?: (index: number) => PageSetup;
  setSectionSetup?: (index: number, partial: Partial<PageSetup>) => void;
}

/**
 * Floating block-tools orchestrator. Owns the left-gutter indicator and
 * the floating toolbar that opens above the active block.
 *
 * The indicator, zone-edit hand-off, positioning, animation, and
 * per-kind tools stay coordinated here so block-level UI remains an
 * opt-in plugin instead of leaking into the core editor.
 */
export class BlockTools {
  private readonly stackRoot: HTMLElement;
  private readonly editor: Editor;
  private readonly getSetup: () => PageSetup;
  private readonly setSetup: (s: PageSetup) => void;
  private readonly getSectionCount: () => number;
  private readonly getSectionSetup: (index: number) => PageSetup;
  private readonly setSectionSetup: (index: number, partial: Partial<PageSetup>) => void;
  private closePageSetupPopover: (() => void) | null = null;
  private readonly indicator: BlockIndicator;
  private readonly toolbar: FloatingToolbar;
  private zoneEditing = false;
  /** Currently-open zone-edit `finish()` (returned by `enterZoneEdit`),
   *  or null when not editing. Lets a second indicator click commit. */
  private exitZoneEdit: (() => void) | null = null;
  private suspended = false;
  private detachTools: (() => void) | null = null;
  private closeChangePopover: (() => void) | null = null;
  /** Current table-toolbar mode (Cell vs Table). Reset when the toolbar closes. */
  private tableMode: TableMode = "cell";
  private readonly onDocumentDownFn = (e: MouseEvent) => this.onDocumentDown(e);

  constructor(opts: BlockToolsOptions) {
    this.stackRoot = opts.stackRoot;
    this.editor = opts.editor;
    this.getSetup = opts.getSetup;
    this.setSetup = opts.setSetup;
    // Section APIs default to a single-section view backed by getSetup /
    // setSetup. Embedders that pass the multi-section trio (createSobree
    // does) get section-aware editing for free.
    this.getSectionCount = opts.getSectionCount ?? (() => 1);
    this.getSectionSetup = opts.getSectionSetup ?? ((_) => opts.getSetup());
    this.setSectionSetup =
      opts.setSectionSetup ??
      ((index, partial) => {
        if (index !== 0) return;
        opts.setSetup({ ...opts.getSetup(), ...partial });
      });

    this.toolbar = new FloatingToolbar({
      editor: this.editor,
      renderingArea: opts.renderingArea,
      viewport: opts.viewport ?? null,
    });

    this.indicator = new BlockIndicator({
      stackRoot: this.stackRoot,
      editor: this.editor,
      onActivate: (target) => this.handleActivate(target),
    });

    // Click-away closes the toolbar.
    document.addEventListener("mousedown", this.onDocumentDownFn, true);
  }

  destroy(): void {
    document.removeEventListener("mousedown", this.onDocumentDownFn, true);
    this.toolbar.destroy();
    this.indicator.destroy();
  }

  /** Call after pagination / zoom changes so the indicator + toolbar re-align. */
  refresh(): void {
    this.indicator.refresh();
    if (this.toolbar.isOpen()) this.toolbar.reposition();
  }

  /**
   * Suspend all UI — indicator hidden, toolbar closed, interactions
   * ignored. Used when the host switches Sobree into read mode.
   */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) {
      this.closeToolbar();
      this.indicator.setEnabled(false);
    } else {
      this.indicator.setEnabled(true);
    }
  }

  private handleActivate(target: BlockTarget): void {
    if (this.suspended) return;
    if (this.zoneEditing) {
      // Second click on the indicator while editing the same zone → commit
      // and exit. Clicking the indicator on a *different* block does
      // nothing while editing — the click-outside handler in zoneEdit will
      // commit, then BlockTools is free to act on the new target.
      this.exitZoneEdit?.();
      return;
    }
    if (target.kind === "header" || target.kind === "footer") {
      this.enterZoneEdit(target.element, target.kind);
      return;
    }

    // Toggle: click the same indicator again → close.
    if (this.toolbar.isOpen() && this.toolbar.getTarget()?.element === target.element) {
      this.closeToolbar();
      return;
    }

    this.openToolbar(target);
  }

  private openToolbar(target: BlockTarget): void {
    this.detachTools?.();

    const changeCtx = this.buildChangeTypeContext(target);

    if (target.kind === "table") {
      // Table toolbar builds its own content (text tools + pill + ops).
      // Append the change-type trigger at the end.
      this.renderTableToolbar(target, changeCtx);
    } else {
      const isMulti = changeCtx.refs.length > 1;
      // Multi-block: text tools only (no per-kind primary tools).
      const perKindHtml = isMulti ? "" : buildPerKindHtml(target.kind);
      this.toolbar.setContent(
        buildTextToolsHtml() +
          perKindHtml +
          buildChangeTypeButton(changeCtx.refs.length) +
          this.buildTrailingToolsHtml(),
      );
      this.toolbar.open(target);
      const detachText = wireTextTools(this.toolbar.root, {
        editor: this.editor,
        target,
      });
      const detachPerKind = isMulti
        ? () => {}
        : wirePerKindTools(this.toolbar.root, {
            editor: this.editor,
            target,
          });
      const detachChange = this.wireChangeTypeTrigger(changeCtx);
      const detachTrailing = this.wireTrailingTools();
      this.detachTools = () => {
        detachText();
        detachPerKind();
        detachChange();
        detachTrailing();
      };
    }
    this.indicator.setActive(true);
  }

  /**
   * Resolve which blocks the "change type" drill-down should apply to.
   * Multi-block range selections return the full chain of block refs
   * between `from` and `to` (inclusive). Everything else returns the
   * single block under the caret / indicator.
   */
  private buildChangeTypeContext(target: BlockTarget): ChangeTypeContext {
    const range = this.editor.selection.currentRange();
    const refs: BlockRef[] = [];
    if (range && range.from.block.id !== range.to.block.id) {
      // Collect every block from the first to the last selected.
      const blocks = this.editor.getBlocks();
      const fromIdx = blocks.findIndex((b) => b.id === range.from.block.id);
      const toIdx = blocks.findIndex((b) => b.id === range.to.block.id);
      if (fromIdx >= 0 && toIdx >= 0) {
        const lo = Math.min(fromIdx, toIdx);
        const hi = Math.max(fromIdx, toIdx);
        for (let i = lo; i <= hi; i++) {
          const b = blocks[i];
          if (b) refs.push({ id: b.id, version: b.version });
        }
      }
    }
    if (refs.length === 0) {
      const caret = this.editor.selection.currentBlock();
      if (caret) refs.push(caret);
      else {
        const first = this.editor.getBlocks()[0];
        if (first) refs.push({ id: first.id, version: first.version });
      }
    }
    return { editor: this.editor, target, refs };
  }

  private wireChangeTypeTrigger(ctx: ChangeTypeContext): () => void {
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest(
        'button[data-action="open-change-type"]',
      ) as HTMLButtonElement | null;
      if (!btn) return;
      e.preventDefault();
      // Toggle: if already open, close. Otherwise open. Mirror the
      // open/closed state via `aria-expanded` so screen readers know
      // whether activating the button will open or close the menu.
      if (this.closeChangePopover) {
        this.closeChangePopover();
        return;
      }
      btn.setAttribute("aria-expanded", "true");
      this.closeChangePopover = openChangeTypePopover(btn, ctx, () => {
        btn.setAttribute("aria-expanded", "false");
        this.closeChangePopover = null;
      });
    };
    this.toolbar.root.addEventListener("click", onClick);
    return () => this.toolbar.root.removeEventListener("click", onClick);
  }

  /**
   * Table-specific toolbar: text tools on the left, Cell/Table pill in
   * the middle, mode-specific ops on the right. Mode defaults to Cell
   * when the caret is in a cell, Table otherwise.
   */
  private renderTableToolbar(target: BlockTarget, changeCtx: ChangeTypeContext): void {
    const cell = this.resolveCell(target);
    this.tableMode = cell ? "cell" : "table";
    this.renderTableToolbarBody(target, cell, changeCtx);
    this.toolbar.open(target);
  }

  private renderTableToolbarBody(
    target: BlockTarget,
    cell: CellLocation | null,
    changeCtx: ChangeTypeContext,
  ): void {
    // Tear down any prior wiring first — otherwise each mode toggle
    // leaves another live listener on the root, and clicks start firing
    // multiple times.
    this.detachTools?.();
    this.toolbar.setContent(
      buildTextToolsHtml() +
        buildTableToolsHtml(this.tableMode, !!cell) +
        buildChangeTypeButton(changeCtx.refs.length) +
        this.buildTrailingToolsHtml(),
    );
    const detachText = wireTextTools(this.toolbar.root, {
      editor: this.editor,
      target,
    });
    const detachTable = wireTableTools(
      this.toolbar.root,
      { editor: this.editor, target, cell },
      (nextMode) => {
        this.tableMode = nextMode;
        this.renderTableToolbarBody(target, this.resolveCell(target), changeCtx);
      },
    );
    const detachChange = this.wireChangeTypeTrigger(changeCtx);
    const detachTrailing = this.wireTrailingTools();
    this.detachTools = () => {
      detachText();
      detachTable();
      detachChange();
      detachTrailing();
    };
  }

  /**
   * Tools that sit at the very right of every toolbar variant — global
   * affordances that aren't tied to the active block. Currently:
   *   - Page setup — always present; opens an internal section-aware
   *     popover. If the host has registered a `page-setup.open` command,
   *     that wins (lets embedders ship their own modal).
   */
  private buildTrailingToolsHtml(): string {
    const useHostCommand = this.editor.commands.has("page-setup.open");
    const action = useHostCommand
      ? `data-action="exec-command" data-command="page-setup.open"`
      : `data-action="open-page-setup" aria-haspopup="dialog" aria-expanded="false"`;
    const pageSetupBtn = `<button type="button" ${action} title="Page &amp; section setup" aria-label="Page and section setup">${icon("page-setup")}</button>`;
    // Track-changes pill — same place as page-setup so it's present in
    // every block-type toolbar (paragraph, heading, list, image, table,
    // multi-select). Toggles `editor.trackChanges.enabled` and mirrors
    // its visual state via the editor's `track-changes-change` event.
    // Author identity is *not* changed here: the toggle preserves whatever
    // author the embedder has set via `editor.setTrackChanges(...)`. If
    // none was set, authored revisions land with no author field
    // (Word's "anonymous tracked change").
    const tc = this.editor.getTrackChanges();
    const pressed = tc.enabled ? "true" : "false";
    const activeCls = tc.enabled ? " is-active" : "";
    const tcLabel = tc.enabled ? "Track changes (on)" : "Track changes (off)";
    const tcBtn = `<button type="button" class="tb-action${activeCls}" data-action="toggle-track-changes" aria-pressed="${pressed}" title="${tcLabel}" aria-label="${tcLabel}">${icon("track-changes")}</button>`;
    // Author identity input — only rendered when track-changes is on,
    // so the toolbar isn't cluttered by an input the user doesn't need.
    // Writes through `editor.setTrackChanges` keeping `enabled: true`
    // so the pill stays lit. The placeholder ("Anonymous") matches
    // Word's behaviour for an unset author.
    const authorValue = tc.author !== undefined ? escapeHtmlAttr(tc.author) : "";
    const authorInput = tc.enabled
      ? `<input type="text" class="tb-author-input" data-role="track-changes-author" value="${authorValue}" placeholder="Anonymous" title="Track changes author" aria-label="Track changes author" maxlength="60" />`
      : "";
    return `<div class="tb-divider"></div><div class="tb-group" data-group="trailing">${tcBtn}${authorInput}${pageSetupBtn}</div>`;
  }

  /**
   * Delegated click handler for trailing-toolbar buttons. Two flavours:
   *   - `data-action="exec-command"` dispatches through the command bus
   *     (same path keyboard / MCP / agent would use).
   *   - `data-action="open-page-setup"` opens the built-in section-aware
   *     popover, anchored to the clicked button.
   */
  private wireTrailingTools(): () => void {
    // Keep the pill's pressed state + author input in sync with editor
    // state. A toggle from anywhere (the API, another toolbar instance,
    // a keyboard plugin) flows through here. The author input is
    // dynamically inserted/removed by `buildTrailingToolsHtml` based on
    // the enabled flag — but since we don't re-run that during a live
    // toolbar session, we manage the input element imperatively here
    // so it appears/disappears on toggle without re-rendering.
    const syncTrackChangesBtn = () => {
      const state = this.editor.getTrackChanges();
      const pressed = state.enabled;
      // The pill needs to surface TWO things: the mode flag (on/off)
      // AND whether there are unresolved revisions in the doc. The
      // user can toggle the mode off and still have pending revisions
      // they need to act on — without this hint, the pill looks like
      // "all done" when it isn't. The numeric count is set as a data
      // attribute that CSS reads to render a small badge over the
      // pill icon; the full text is in the title for screen readers
      // and hover.
      const unresolved = this.editor.getRevisions().length;
      const modeStr = pressed ? "on" : "off";
      const label =
        unresolved > 0
          ? `Track changes (${modeStr} · ${unresolved} unresolved)`
          : `Track changes (${modeStr})`;
      for (const btn of Array.from(
        this.toolbar.root.querySelectorAll<HTMLButtonElement>(
          'button[data-action="toggle-track-changes"]',
        ),
      )) {
        btn.classList.toggle("is-active", pressed);
        btn.classList.toggle("has-unresolved", unresolved > 0);
        btn.setAttribute("aria-pressed", String(pressed));
        if (unresolved > 0) {
          btn.dataset.unresolvedCount = String(unresolved);
        } else {
          delete btn.dataset.unresolvedCount;
        }
        btn.title = label;
        btn.setAttribute("aria-label", label);
        // Show/hide the author input alongside the pill.
        const trailingGroup = btn.parentElement;
        if (!trailingGroup) continue;
        let input = trailingGroup.querySelector<HTMLInputElement>(
          'input[data-role="track-changes-author"]',
        );
        if (pressed && !input) {
          input = document.createElement("input");
          input.type = "text";
          input.className = "tb-author-input";
          input.dataset.role = "track-changes-author";
          input.placeholder = "Anonymous";
          input.title = "Track changes author";
          input.setAttribute("aria-label", "Track changes author");
          input.maxLength = 60;
          input.value = state.author ?? "";
          btn.insertAdjacentElement("afterend", input);
        } else if (!pressed && input) {
          input.remove();
        } else if (input && input.value !== (state.author ?? "")) {
          // External state change (API call set a different author) —
          // reflect it, unless the input is currently focused (don't
          // stomp the user's in-progress typing).
          if (document.activeElement !== input) {
            input.value = state.author ?? "";
          }
        }
      }
    };
    const detachTrackChanges = this.editor.on("track-changes-change", syncTrackChangesBtn);
    // Also re-sync on every doc `change` so the unresolved-count
    // badge tracks revisions being authored, accepted, or rejected
    // from anywhere — not just from this toolbar's pill.
    const detachChange = this.editor.on("change", syncTrackChangesBtn);
    // Initial paint covers the case where the toolbar just opened and
    // we haven't received an event since.
    syncTrackChangesBtn();

    // Author input — write through `editor.setTrackChanges` on every
    // input event (cheap; the editor de-dupes identical states).
    // Trim and treat the empty string as "anonymous" (no author field).
    const onAuthorInput = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.getAttribute("data-role") !== "track-changes-author") return;
      const raw = (el as HTMLInputElement).value.trim();
      const cur = this.editor.getTrackChanges();
      this.editor.setTrackChanges(
        raw === "" ? { enabled: cur.enabled } : { enabled: cur.enabled, author: raw },
      );
    };
    this.toolbar.root.addEventListener("input", onAuthorInput);

    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest(
        'button[data-action="exec-command"], button[data-action="open-page-setup"], button[data-action="toggle-track-changes"]',
      ) as HTMLButtonElement | null;
      if (!btn) return;
      e.preventDefault();
      const action = btn.getAttribute("data-action");
      if (action === "exec-command") {
        const name = btn.getAttribute("data-command");
        if (name) this.editor.commands.execute(name);
        return;
      }
      if (action === "toggle-track-changes") {
        const cur = this.editor.getTrackChanges();
        // Preserve author when flipping the enabled bit — see the
        // pill's docblock in buildTrailingToolsHtml for rationale.
        this.editor.setTrackChanges(
          cur.author === undefined
            ? { enabled: !cur.enabled }
            : { enabled: !cur.enabled, author: cur.author },
        );
        return;
      }
      // Built-in page-setup popover — toggle.
      if (this.closePageSetupPopover) {
        this.closePageSetupPopover();
        return;
      }
      btn.setAttribute("aria-expanded", "true");
      this.closePageSetupPopover = openPageSetupPopover(
        btn,
        {
          editor: this.editor,
          getSectionCount: this.getSectionCount,
          getSectionSetup: this.getSectionSetup,
          setSectionSetup: this.setSectionSetup,
        },
        () => {
          btn.setAttribute("aria-expanded", "false");
          this.closePageSetupPopover = null;
        },
      );
    };
    this.toolbar.root.addEventListener("click", onClick);
    return () => {
      this.toolbar.root.removeEventListener("click", onClick);
      this.toolbar.root.removeEventListener("input", onAuthorInput);
      detachTrackChanges();
      detachChange();
    };
  }

  private resolveCell(target: BlockTarget): CellLocation | null {
    if (target.element.tagName.toLowerCase() !== "table") return null;
    return locateCellFromSelection(target.element as HTMLTableElement);
  }

  private closeToolbar(): void {
    this.closeChangePopover?.();
    this.closeChangePopover = null;
    this.closePageSetupPopover?.();
    this.closePageSetupPopover = null;
    this.detachTools?.();
    this.detachTools = null;
    this.toolbar.close();
    this.indicator.setActive(false);
  }

  private onDocumentDown(e: MouseEvent): void {
    if (!this.toolbar.isOpen()) return;
    const target = e.target as Node;
    if (this.toolbar.root.contains(target)) return;
    if (e.target instanceof HTMLElement) {
      // Don't close if the click lands on the indicator — that's a toggle.
      if (this.indicator.getCurrent() && e.target.closest(".sobree-block-indicator")) return;
      // Don't close if the click lands inside the open change-block popover
      // (or any toolbar-spawned popover that lives on document.body). The
      // popover removes `is-open` on close, which flips it back to
      // `pointer-events: none` — a premature close here would swallow
      // the user's click before its applyTarget handler runs.
      if (e.target.closest(".sobree-change-popover")) return;
      // Same for the page-setup popover (it reuses the change-popover
      // class for layout but has its own dialog role).
      if (e.target.closest(".sobree-page-setup-popover")) return;
    }
    this.closeToolbar();
  }

  private enterZoneEdit(zone: HTMLElement, kind: "header" | "footer"): void {
    this.zoneEditing = true;
    this.indicator.setActive(true);
    this.exitZoneEdit = enterZoneEdit({
      zone,
      kind,
      stackRoot: this.stackRoot,
      getSetup: this.getSetup,
      setSetup: this.setSetup,
      onExit: () => {
        this.zoneEditing = false;
        this.exitZoneEdit = null;
        this.indicator.setActive(false);
      },
    });
  }
}

/**
 * Escape a value for safe interpolation into an HTML attribute. Used
 * for user-controlled values (e.g. the track-changes author name) so
 * a malicious or accidental string can't break out of the attribute
 * and inject other attributes / script.
 */
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
