import {
  type Editor,
  PAGE_SIZES,
  type PageSetup,
  type PageSizeKey,
  type VerticalAlign,
} from "@sobree/core";

/**
 * Section-aware Page & Section Setup popover.
 *
 * Two groups of controls:
 *
 *   1. Page properties — paper size, orientation, margins. These live
 *      in `PageSetup.size / orientation / margins` and apply to the
 *      selected section.
 *   2. Section properties — vertical alignment, different first /
 *      last page header / footer flags, and an "Insert section break
 *      after current block" affordance (dispatched through the
 *      `section.insertBreakAfter` command registered by core).
 *
 * Edits apply live through `setSectionSetup` — the editor repaginates
 * and the paper visibly resizes per keystroke. Pre-selects the section
 * the caret currently sits in (computed by counting `section_break`
 * blocks before it).
 */
export interface PageSetupContext {
  editor: Editor;
  getSectionCount: () => number;
  getSectionSetup: (index: number) => PageSetup;
  setSectionSetup: (index: number, partial: Partial<PageSetup>) => void;
}

const PAGE_SIZE_KEYS: PageSizeKey[] = ["A3", "A4", "A5", "B5", "Letter", "Legal", "Tabloid"];

const MARGIN_FIELDS = ["top", "right", "bottom", "left"] as const;

const VERTICAL_ALIGNS: VerticalAlign[] = ["top", "center", "bottom", "both"];

export function openPageSetupPopover(
  trigger: HTMLElement,
  ctx: PageSetupContext,
  onClose: () => void,
): () => void {
  const sectionCount = Math.max(1, ctx.getSectionCount());
  let activeIndex = clampIndex(detectCurrentSection(ctx.editor), sectionCount);

  // Capture the editor's selection BEFORE we move focus into the
  // popover. Used by the "Insert section break" button to restore the
  // caret so the underlying command (which reads `currentCaret()`) has
  // somewhere to insert.
  const savedSelection = ctx.editor.selection.get();

  const popover = document.createElement("div");
  popover.className = "sobree-page-setup-popover sobree-change-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Page and section setup");
  popover.tabIndex = -1;
  document.body.appendChild(popover);

  // Section break can only be inserted at a real caret position. The
  // command is registered by core's always-on `attachSections` plugin.
  const canInsertBreak = ctx.editor.commands.has("section.insertBreakAfter");

  const render = () => {
    const setup = ctx.getSectionSetup(activeIndex);
    popover.innerHTML = buildHtml(sectionCount, activeIndex, setup, canInsertBreak);
    wire(
      popover,
      ctx,
      () => activeIndex,
      (next) => {
        activeIndex = next;
        render(); // re-render so the form reflects the newly-selected section
      },
      () => close(),
      savedSelection,
    );
  };

  render();

  // Position below the trigger, clamped to the viewport.
  const triggerRect = trigger.getBoundingClientRect();
  const POPOVER_WIDTH = 320;
  const left = Math.max(8, Math.min(window.innerWidth - POPOVER_WIDTH - 8, triggerRect.left));
  popover.style.top = `${triggerRect.bottom + 6}px`;
  popover.style.left = `${left}px`;
  // Trigger the .is-open transition (mirrors sobree-change-popover) on
  // the next frame so the fade-in actually animates instead of being
  // skipped by the initial paint.
  requestAnimationFrame(() => popover.classList.add("is-open"));

  // Click-away closes (but ignore clicks inside the popover or on the
  // trigger button — those are handled internally / open-toggling).
  const onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (popover.contains(t)) return;
    if (trigger.contains(t)) return;
    close();
  };
  // Defer the listener install so the click that opened us doesn't
  // immediately close us.
  const installTimer = window.setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
  }, 0);

  // Esc closes.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  popover.addEventListener("keydown", onKey);

  // Focus the section picker (or the first form field) for keyboard nav.
  queueMicrotask(() => {
    const first = popover.querySelector<HTMLElement>("select, input") ?? popover;
    first.focus();
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(installTimer);
    document.removeEventListener("mousedown", onDown, true);
    popover.removeEventListener("keydown", onKey);
    popover.remove();
    onClose();
  };

  return close;
}

// === markup ===

function buildHtml(
  sectionCount: number,
  activeIndex: number,
  setup: PageSetup,
  canInsertBreak: boolean,
): string {
  const sectionPicker =
    sectionCount > 1
      ? `
        <label class="ps-row">
          <span class="ps-label">Section</span>
          <select data-field="section">
            ${Array.from({ length: sectionCount }, (_, i) => {
              const sel = i === activeIndex ? " selected" : "";
              return `<option value="${i}"${sel}>Section ${i + 1}</option>`;
            }).join("")}
          </select>
        </label>`
      : "";

  // Page properties group — paper size, orientation, margins.
  const pageGroup = `
    <div class="ps-section-header">Page</div>
    <div class="ps-grid">
      <label class="ps-row">
        <span class="ps-label">Size</span>
        <select data-field="size">
          ${PAGE_SIZE_KEYS.map((k) => {
            const sel = k === setup.size ? " selected" : "";
            const dim = PAGE_SIZES[k];
            return `<option value="${k}"${sel}>${k} (${dim.width} × ${dim.height} mm)</option>`;
          }).join("")}
        </select>
      </label>
      <label class="ps-row">
        <span class="ps-label">Orientation</span>
        <select data-field="orientation">
          <option value="portrait"${setup.orientation === "portrait" ? " selected" : ""}>Portrait</option>
          <option value="landscape"${setup.orientation === "landscape" ? " selected" : ""}>Landscape</option>
        </select>
      </label>
      <div class="ps-row ps-margins">
        <span class="ps-label">Margins (mm)</span>
        <div class="ps-margin-grid">
          ${MARGIN_FIELDS.map(
            (side) => `
            <label class="ps-margin">
              <span>${side}</span>
              <input type="number" min="0" step="1" data-field="margin-${side}" value="${setup.margins[side]}" />
            </label>`,
          ).join("")}
        </div>
      </div>
    </div>`;

  // Section properties group — vAlign + page-variation flags + insert-break.
  const differentFirst = setup.header.differentFirst || setup.footer.differentFirst;
  const differentLast = setup.header.differentLast || setup.footer.differentLast;
  const sectionGroup = `
    <div class="ps-section-header">Section</div>
    <div class="ps-grid">
      <label class="ps-row">
        <span class="ps-label">Vertical alignment</span>
        <select data-field="vertical-align">
          ${VERTICAL_ALIGNS.map((v) => {
            const sel = v === setup.verticalAlign ? " selected" : "";
            return `<option value="${v}"${sel}>${capitalize(v)}</option>`;
          }).join("")}
        </select>
      </label>
      <label class="ps-row ps-checkbox">
        <input type="checkbox" data-field="different-first"${differentFirst ? " checked" : ""} />
        <span>Different header / footer for first page</span>
      </label>
      <label class="ps-row ps-checkbox">
        <input type="checkbox" data-field="different-last"${differentLast ? " checked" : ""} />
        <span>Different header / footer for last page</span>
      </label>
      ${
        canInsertBreak
          ? `<button type="button" class="ps-insert-break" data-action="insert-section-break">
               Insert section break after current block
             </button>`
          : ""
      }
    </div>`;

  return `
    <div class="ps-header">Page &amp; section setup</div>
    ${sectionPicker}
    ${pageGroup}
    ${sectionGroup}
  `;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// === wiring ===

function wire(
  root: HTMLElement,
  ctx: PageSetupContext,
  getActive: () => number,
  onSectionChange: (index: number) => void,
  closePopover: () => void,
  savedSelection: ReturnType<Editor["selection"]["get"]>,
): void {
  // Section picker — switching sections re-renders the form.
  const sectionEl = root.querySelector<HTMLSelectElement>('select[data-field="section"]');
  if (sectionEl) {
    sectionEl.addEventListener("change", () => {
      const next = Number(sectionEl.value);
      if (Number.isFinite(next)) onSectionChange(next);
    });
  }

  // Size + orientation — apply on change.
  const sizeEl = root.querySelector<HTMLSelectElement>('select[data-field="size"]');
  sizeEl?.addEventListener("change", () => {
    ctx.setSectionSetup(getActive(), { size: sizeEl.value as PageSizeKey });
  });

  const orientationEl = root.querySelector<HTMLSelectElement>('select[data-field="orientation"]');
  orientationEl?.addEventListener("change", () => {
    ctx.setSectionSetup(getActive(), {
      orientation: orientationEl.value as PageSetup["orientation"],
    });
  });

  // Margins — debounced live updates so the paper resizes as the user
  // pauses typing, but each keystroke doesn't trigger a setDocument
  // round-trip (which steals focus back to the editor and would yank
  // the caret out of the input mid-typing). Also commits immediately
  // on `change` (blur / Enter / spinner click) so explicit commits feel
  // snappy.
  for (const side of MARGIN_FIELDS) {
    const input = root.querySelector<HTMLInputElement>(`input[data-field="margin-${side}"]`);
    if (!input) continue;
    const apply = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0) return;
      const current = ctx.getSectionSetup(getActive());
      // Save caret state, then restore focus + caret AFTER setDocument
      // re-applies the editor selection (which steals focus on its
      // own microtask). Without this the input loses focus on every
      // commit while the user is still typing.
      const wasActive = document.activeElement === input;
      const caretStart = input.selectionStart;
      const caretEnd = input.selectionEnd;
      ctx.setSectionSetup(getActive(), {
        margins: { ...current.margins, [side]: value },
      });
      if (wasActive) {
        // Two rAFs: first clears the synchronous setDocument focus
        // restore; second handles any deferred work that runs in the
        // following microtask (e.g. paginator's selection re-apply).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (document.activeElement !== input) input.focus();
            if (caretStart !== null && caretEnd !== null) {
              try {
                input.setSelectionRange(caretStart, caretEnd);
              } catch {
                /* number inputs may reject setSelectionRange in some
                   browsers — silent fallback is fine, focus is what
                   matters. */
              }
            }
          });
        });
      }
    };
    const debouncedApply = debounce(apply, 1000);
    input.addEventListener("input", debouncedApply);
    // Explicit commit on blur / Enter / spinner so the user can short-
    // circuit the debounce by tabbing away or pressing Enter.
    input.addEventListener("change", apply);
  }

  // Vertical alignment — apply on change.
  const vAlignEl = root.querySelector<HTMLSelectElement>('select[data-field="vertical-align"]');
  vAlignEl?.addEventListener("change", () => {
    ctx.setSectionSetup(getActive(), {
      verticalAlign: vAlignEl.value as VerticalAlign,
    });
  });

  // Different first / last header & footer — apply on change. Mirror
  // the flag onto BOTH header and footer; that's how Word presents the
  // checkboxes to the user (per-section, not per-zone).
  const differentFirst = root.querySelector<HTMLInputElement>(
    'input[data-field="different-first"]',
  );
  differentFirst?.addEventListener("change", () => {
    const current = ctx.getSectionSetup(getActive());
    const checked = differentFirst.checked;
    ctx.setSectionSetup(getActive(), {
      header: { ...current.header, differentFirst: checked },
      footer: { ...current.footer, differentFirst: checked },
    });
  });

  const differentLast = root.querySelector<HTMLInputElement>('input[data-field="different-last"]');
  differentLast?.addEventListener("change", () => {
    const current = ctx.getSectionSetup(getActive());
    const checked = differentLast.checked;
    ctx.setSectionSetup(getActive(), {
      header: { ...current.header, differentLast: checked },
      footer: { ...current.footer, differentLast: checked },
    });
  });

  // Insert section break — runs the bus command, then closes the
  // popover so the user can see the result. New section appears as the
  // next entry in the section picker on the next open.
  const insertBreakBtn = root.querySelector<HTMLButtonElement>(
    'button[data-action="insert-section-break"]',
  );
  insertBreakBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    // Restore the editor selection that was live when the popover
    // opened — the command reads `editor.selection.currentCaret()` and
    // the popover stole focus on open. Without this the command silently
    // no-ops.
    if (savedSelection) ctx.editor.selection.set(savedSelection);
    ctx.editor.commands.execute("section.insertBreakAfter");
    closePopover();
  });
}

// === section detection ===

/**
 * Section the caret is currently in. We count `section_break` blocks
 * up to (and not including) the caret's block; each break advances the
 * section index by one.
 *
 * Falls back to section 0 when there's no caret (e.g. just-mounted
 * editor with no focus yet).
 */
function detectCurrentSection(editor: Editor): number {
  const caret = editor.selection.currentBlock();
  if (!caret) return 0;
  const blocks = editor.getBlocks();
  let section = 0;
  for (const b of blocks) {
    if (b.id === caret.id) return section;
    if (b.kind === "section_break") section += 1;
  }
  return section;
}

function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  if (index >= count) return Math.max(0, count - 1);
  return index;
}

/** Trailing-edge debounce — fn runs once, `ms` after the last call. */
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}
