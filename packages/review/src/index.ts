/**
 * `@sobree/review` — tracked-changes & comments review surface.
 *
 * `@sobree/core` renders the *semantic* marks (`<ins>` / `<del>` /
 * comment-range highlight) in neutral styling — visible without any
 * plugin, so an imported docx never silently reads wrong. This plugin
 * layers the *review surface* on top:
 *
 *   - per-author colour on the inline marks
 *   - post-it comment cards in the right-margin sidebar, threaded and
 *     vertically aligned to the text they annotate
 *   - (accept/reject/resolve actions — wired in a later step)
 *
 * It owns no document state: it reacts to `paginate` events, reads the
 * AST via `editor.getDocument()`, and decorates the already-rendered
 * DOM. Removing the plugin removes the surface, not the data.
 *
 * Recommended usage:
 *
 *   import { review } from "@sobree/review";
 *   createSobree(host, { plugins: [review()] });
 */

import "./review.css";
import type {
  Block,
  Comment,
  Editor,
  FloatingCornerPlacement,
  InlineRun,
  PluginContext,
  SobreePlugin,
  SobreeUnsubscribe,
} from "@sobree/core";
import { RevisionActions } from "./actions";
import { colorForAuthor } from "./authorColor";
import { ReviewDock } from "./dock";
import { ICON_REOPEN, ICON_RESOLVE } from "./icons";

export { colorForAuthor, authorSlot } from "./authorColor";

export interface ReviewOptions {
  /**
   * Show the per-page comment sidebar. When false, the plugin still
   * colours the inline marks per author but renders no cards. Default
   * true.
   */
  showComments?: boolean;
  /**
   * Show the top-level review dock — a floating pill with count +
   * prev/next + accept-all/reject-all. Auto-shows when revisions
   * exist, auto-hides when the doc is clean. Default true.
   */
  showDock?: boolean;
  /**
   * Which corner of the rendering area the dock pins to. Defaults to
   * `top-right`. Stacks cleanly with other plugins' floating UIs in
   * the same corner (zoom-controls, etc.) via core's shared
   * `getFloatingCorner` utility.
   */
  dockPlacement?: FloatingCornerPlacement;
}

/** Plugin factory — hand to `createSobree({ plugins: [review()] })`. */
export function review(opts: ReviewOptions = {}): SobreePlugin {
  return {
    name: "review",
    setup(ctx: PluginContext) {
      const controller = new ReviewController(ctx, opts);
      return { destroy: () => controller.destroy() };
    },
  };
}

/** Vertical gap between two stacked comment cards (px, pre-transform). */
const CARD_GAP = 8;

class ReviewController {
  private readonly editor: Editor;
  private readonly stackRoot: HTMLElement;
  private readonly showComments: boolean;
  private readonly unsubs: SobreeUnsubscribe[] = [];
  private readonly revisionActions: RevisionActions;
  private readonly dock: ReviewDock | null;
  /** Pending debounce handles — `null` when no refresh is queued. */
  private rafId: number | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: PluginContext, opts: ReviewOptions) {
    this.editor = ctx.editor;
    this.stackRoot = ctx.sobree.stackRoot;
    this.showComments = opts.showComments ?? true;
    // Hover-popover accept/reject for tracked-change marks. It fetches
    // `editor.getRevisions()` live on each hover, so the range it
    // mutates always carries current block versions.
    this.revisionActions = new RevisionActions(this.editor, this.stackRoot);
    // Top-level review dock — count + prev/next + accept-all/reject-all.
    // Anchored via core's shared floating-corner stack so it cohabits
    // cleanly with any other dock the embedder mounts in the same
    // corner (zoom-controls, etc.).
    this.dock =
      (opts.showDock ?? true)
        ? new ReviewDock({
            host: ctx.host,
            editor: this.editor,
            stackRoot: this.stackRoot,
            ...(opts.dockPlacement !== undefined ? { placement: opts.dockPlacement } : {}),
          })
        : null;
    // `paginate` is the "DOM re-laid-out" signal — it fires after every
    // content change → repaginate cycle, so card *positions* are fresh.
    // `change` additionally catches mutations that don't repaginate —
    // notably comment resolve/reopen, which only touches document
    // metadata — so the cards re-render to reflect the new state.
    // Both funnel through the debounced `schedule()`, which coalesces a
    // paired change+paginate into one refresh.
    this.unsubs.push(ctx.sobree.on("paginate", () => this.schedule()));
    this.unsubs.push(ctx.sobree.on("change", () => this.schedule()));
    this.schedule();
  }

  /**
   * Coalesce a burst of events into a single refresh.
   *
   * We arm an animation frame *and* a timer, and the first to fire
   * wins (cancelling the other). The rAF gives frame-aligned layout
   * reads when the tab is visible; the timer is the safety net —
   * `requestAnimationFrame` callbacks are paused entirely in a hidden
   * tab, so an rAF-only debounce would wedge permanently (`pending`
   * never clears) and the review surface would go dark. Timers keep
   * running (throttled) in background tabs, so the timer guarantees
   * the surface still updates and can never get stuck.
   */
  private schedule(): void {
    if (this.rafId !== null || this.timerId !== null) return;
    const run = (): void => {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      try {
        this.refresh();
      } catch (err) {
        console.error("[review] refresh failed:", err);
      }
    };
    this.rafId = requestAnimationFrame(run);
    this.timerId = setTimeout(run, 100);
  }

  private refresh(): void {
    colourMarks(this.stackRoot);
    if (this.showComments) {
      const comments = this.editor.getDocument().comments ?? {};
      renderComments(this.stackRoot, comments, this.editor);
    }
    // Dock reads `editor.getRevisions()` itself; refresh paints the
    // count + author summary and auto-shows/hides based on the result.
    this.dock?.refresh();
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.revisionActions.destroy();
    this.dock?.destroy();
    // Leave core's neutral marks intact; just clear what we added.
    for (const el of Array.from(
      this.stackRoot.querySelectorAll<HTMLElement>(
        "ins[data-revision-author], del[data-revision-author]",
      ),
    )) {
      el.style.removeProperty("--author-color");
    }
    for (const el of Array.from(
      this.stackRoot.querySelectorAll<HTMLElement>("[data-block-revision]"),
    )) {
      el.style.removeProperty("--sobree-block-revision-color");
    }
    for (const el of Array.from(
      this.stackRoot.querySelectorAll<HTMLElement>("span.sobree-revision-format"),
    )) {
      el.style.removeProperty("--sobree-format-revision-color");
    }
    for (const slot of Array.from(
      this.stackRoot.querySelectorAll<HTMLElement>(".paper-comments"),
    )) {
      slot.replaceChildren();
      slot.classList.add("is-empty");
    }
  }
}

// ---------- inline marks ----------

/** Apply per-author colour to every tracked-change mark in `root`. */
function colourMarks(root: HTMLElement): void {
  // Inline ins/del runs.
  const marks = root.querySelectorAll<HTMLElement>(
    "ins[data-revision-author], del[data-revision-author]",
  );
  for (const mark of Array.from(marks)) {
    mark.style.setProperty("--author-color", colorForAuthor(mark.dataset.revisionAuthor));
  }
  // Paragraph-mark revisions — `data-block-revision="ins"|"del"` lives
  // on the paragraph element; the `::after` pseudo in core reads
  // `--sobree-block-revision-color`, which we set per-author here.
  const blockMarks = root.querySelectorAll<HTMLElement>("[data-block-revision]");
  for (const mark of Array.from(blockMarks)) {
    mark.style.setProperty(
      "--sobree-block-revision-color",
      colorForAuthor(mark.dataset.blockRevisionAuthor),
    );
  }
  // Format-change revisions — the wrapping `<span.sobree-revision-format>`
  // reads `--sobree-format-revision-color` to colour the dashed
  // underline core ships as the neutral visual hint.
  const formatMarks = root.querySelectorAll<HTMLElement>("span.sobree-revision-format");
  for (const mark of Array.from(formatMarks)) {
    mark.style.setProperty(
      "--sobree-format-revision-color",
      colorForAuthor(mark.dataset.revisionFormatAuthor),
    );
  }
}

// ---------- comment cards ----------

/**
 * Build the post-it comment cards for every paper and place them in
 * the per-paper `.paper-comments` sidebar slot, vertically aligned to
 * the comment ranges they annotate.
 */
function renderComments(
  root: HTMLElement,
  comments: Record<number, Comment>,
  editor: Editor,
): void {
  // parent → replies index, for threading.
  const repliesByParent = new Map<number, Comment[]>();
  for (const c of Object.values(comments)) {
    // `replyToId` is absent on a top-level comment — but a YDoc
    // round-trip can materialise the missing field as `null`, so
    // treat `null` and `undefined` alike (`== null`).
    if (c.replyToId == null) continue;
    const list = repliesByParent.get(c.replyToId) ?? [];
    list.push(c);
    repliesByParent.set(c.replyToId, list);
  }
  for (const list of repliesByParent.values()) list.sort((a, b) => a.id - b.id);

  for (const row of Array.from(root.querySelectorAll<HTMLElement>(".paper-row"))) {
    const paper = row.querySelector<HTMLElement>(".paper");
    const slot = row.querySelector<HTMLElement>(".paper-comments");
    if (!paper || !slot) continue;
    slot.replaceChildren();

    // Collect (commentId, anchorTopPx) for top-level comments whose
    // range starts on this paper, in document order.
    const placements: { id: number; top: number }[] = [];
    const seen = new Set<number>();
    const anchors = paper.querySelectorAll<HTMLElement>(".sobree-comment-range");
    for (const anchor of Array.from(anchors)) {
      const raw = anchor.dataset.commentIds ?? "";
      for (const part of raw.split(",")) {
        const id = Number(part.trim());
        if (!Number.isFinite(id) || seen.has(id)) continue;
        const c = comments[id];
        // Skip replies (they ride their parent card). `!= null` so a
        // YDoc-materialised `null` still counts as "top-level".
        if (!c || c.replyToId != null) continue;
        seen.add(id);
        placements.push({ id, top: offsetWithin(anchor, paper) });
      }
    }
    if (placements.length === 0) {
      slot.classList.add("is-empty");
      continue;
    }
    slot.classList.remove("is-empty");

    // Place cards top-down, pushing later cards past earlier ones so
    // threads never overlap (the classic comment-margin layout).
    placements.sort((a, b) => a.top - b.top);
    let cursor = 0;
    for (const { id, top } of placements) {
      const card = buildThreadCard(comments[id]!, repliesByParent, editor);
      card.style.top = `${Math.max(top, cursor)}px`;
      slot.appendChild(card);
      cursor = Math.max(top, cursor) + card.offsetHeight + CARD_GAP;
    }
  }
}

/** Build one post-it: the top-level comment + its reply thread. */
function buildThreadCard(
  root: Comment,
  repliesByParent: Map<number, Comment[]>,
  editor: Editor,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "sobree-review-card";
  card.dataset.commentId = String(root.id);

  const emit = (c: Comment, depth: number): void => {
    card.appendChild(buildCommentEl(c, depth, editor));
    for (const reply of repliesByParent.get(c.id) ?? []) emit(reply, depth + 1);
  };
  emit(root, 0);
  return card;
}

/** One comment within a thread card. */
function buildCommentEl(c: Comment, depth: number, editor: Editor): HTMLElement {
  const el = document.createElement("article");
  el.className = "sobree-review-comment";
  if (depth > 0) el.classList.add("is-reply");
  if (c.done) el.classList.add("is-resolved");
  el.dataset.commentId = String(c.id);
  el.id = `sobree-comment-${c.id}`;

  const header = document.createElement("header");
  header.className = "sobree-review-comment__header";
  const author = document.createElement("span");
  author.className = "sobree-review-comment__author";
  author.textContent = c.author ?? "Anonymous";
  author.style.color = colorForAuthor(c.author);
  header.appendChild(author);
  if (c.date) {
    const time = document.createElement("time");
    time.className = "sobree-review-comment__date";
    time.dateTime = c.date;
    time.textContent = c.date.slice(0, 10);
    header.appendChild(time);
  }
  if (c.done) {
    const badge = document.createElement("span");
    badge.className = "sobree-review-comment__status";
    badge.textContent = "✓ Resolved";
    header.appendChild(badge);
  }
  // Resolve / reopen toggle — flips `Comment.done` via the editor.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sobree-review-comment__action";
  const reopening = !!c.done;
  toggle.title = reopening ? "Reopen comment" : "Resolve comment";
  toggle.setAttribute("aria-label", toggle.title);
  toggle.innerHTML = reopening ? ICON_REOPEN : ICON_RESOLVE;
  toggle.addEventListener("click", () => {
    const result = reopening ? editor.reopenComment(c.id) : editor.resolveComment(c.id);
    if (!result.ok) {
      console.warn("[review] resolve/reopen failed:", result.error);
    }
  });
  header.appendChild(toggle);
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "sobree-review-comment__body";
  body.textContent = flattenBlocks(c.body);
  el.appendChild(body);
  return el;
}

/** Flatten a comment body (`Block[]`) to plain text — comment bodies
 *  are short, so rich formatting is dropped for now. */
function flattenBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.kind !== "paragraph") continue;
    parts.push(b.runs.map(inlineText).join(""));
  }
  return parts.join("\n");
}

function inlineText(run: InlineRun): string {
  if (run.kind === "text") return run.text;
  if (run.kind === "hyperlink") return run.children.map(inlineText).join("");
  if (run.kind === "tab") return "\t";
  return "";
}

/** Vertical offset of `el` relative to `ancestor`, in layout px
 *  (transform-independent — uses the offsetTop chain, not rects). */
function offsetWithin(el: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}
