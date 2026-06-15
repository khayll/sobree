import type { AnchoredFrame, SectionProperties } from "../doc/types";
import type { AnchorLayerContext } from "../editor/view/docRenderer/anchorLayer";
import { resolveAnchorPosition } from "../editor/view/docRenderer/anchorPosition";
import { EMU_PER_PX } from "../editor/view/docRenderer/units";
import { type PageSetup, type VerticalAlign, resolvedDimensions } from "./pageSetup";
import { type ZoneRenderContext, paintZoneFrames, renderZone, setZoneText } from "./paperZone";

export type { ZoneRenderContext } from "./paperZone";

/**
 * A single paper — exactly one page. Fixed width and height from the page
 * setup. Has a header zone, a content area, and a footer zone. The content
 * area is where editable blocks live (the PaperStack assigns them here).
 *
 * Header/footer elements are contentEditable=false; the content area inherits
 * editability from the PaperStack root.
 */
export class Paper {
  /**
   * Outer row container — holds the paper card + the right-side
   * comments sidebar. `PaperStack` appends this to its root; CSS uses
   * flex layout so comments sit beside (not inside) the paper.
   */
  readonly outer: HTMLElement;
  /** The paper card itself — sized to the page dimensions. */
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  /**
   * Per-page footnote zone. Sits between body content and the footer
   * INSIDE the paper card. Populated by `PaperStack` after pagination
   * distributes footnote bodies to the page where their referencing
   * `<sup>` landed. Empty zones get `is-empty` for CSS hiding.
   */
  readonly footnotes: HTMLElement;
  /**
   * Per-page floating-object overlay. Absolute-positioned children
   * (anchored textboxes, decorative shapes, anchored pictures) live
   * here, painted on top of `content` by the renderer's anchor-layer
   * module. The paginator never sees these — flow content and
   * floating content are fully decoupled.
   */
  readonly anchors: HTMLElement;
  /**
   * Per-page side gutter — sits to the RIGHT of the paper card
   * (sibling of `root`, child of `outer`). Core leaves it empty (and
   * `is-empty`, so it collapses); the `@sobree/review` plugin fills it
   * with comment cards. Kept in core as a stable mount point so the
   * `.paper-row` flex layout — which the viewport's fit-to-width
   * depends on — doesn't shift when a plugin attaches or detaches.
   */
  readonly comments: HTMLElement;
  private readonly header: HTMLElement;
  private readonly footer: HTMLElement;
  /**
   * Floating overlays for the header / footer zones. Unlike `.paper-
   * anchors` (which overlays only the content rectangle), these span the
   * whole paper card so a header frame's page/margin-relative offsets
   * land at the right spot above the content area. Painted from
   * `headerFooterFrames[partId]` — a zone is flow + floats, like the body.
   */
  private readonly headerAnchors: HTMLElement;
  private readonly footerAnchors: HTMLElement;
  /**
   * BEHIND-text layers — one per frame origin (body / header / footer).
   * A `<wp:anchor behindDoc="1">` frame must paint BELOW the body text
   * but above the paper background. The normal overlay layers are
   * `isolation: isolate` stacking contexts ABOVE the content, so a
   * frame's own `z-index: -1` can never escape them — behind-ness must
   * be expressed by WHICH layer hosts the frame. These sit first in the
   * paper's DOM (painting below every later positioned sibling).
   */
  private readonly anchorsBehind: HTMLElement;
  private readonly headerAnchorsBehind: HTMLElement;
  private readonly footerAnchorsBehind: HTMLElement;

  constructor(container: HTMLElement, setup: PageSetup) {
    this.outer = document.createElement("div");
    this.outer.className = "paper-row";

    this.root = document.createElement("div");
    this.root.className = "paper";

    this.header = document.createElement("div");
    this.header.className = "paper-header";
    this.header.contentEditable = "false";

    this.content = document.createElement("div");
    this.content.className = "paper-content";

    // The anchor layer is a SIBLING of paper-content (not a child).
    // The editor wipes content via `replaceChildren()` on every render,
    // which would destroy any child layer. Sitting alongside content
    // inside the same paper card keeps it pinned to the page geometry
    // and outside the rewrite path. CSS positions it absolutely so it
    // overlays the content rectangle.
    this.anchors = document.createElement("div");
    this.anchors.className = "paper-anchors is-empty";
    this.anchors.contentEditable = "false";

    const behindLayer = (): HTMLElement => {
      const layer = document.createElement("div");
      layer.className = "paper-anchors-behind is-empty";
      layer.contentEditable = "false";
      return layer;
    };
    this.anchorsBehind = behindLayer();
    this.headerAnchorsBehind = behindLayer();
    this.footerAnchorsBehind = behindLayer();

    this.footnotes = document.createElement("div");
    this.footnotes.className = "paper-footnotes is-empty";
    this.footnotes.contentEditable = "false";

    this.footer = document.createElement("div");
    this.footer.className = "paper-footer";
    this.footer.contentEditable = "false";

    this.headerAnchors = document.createElement("div");
    this.headerAnchors.className = "paper-zone-anchors is-empty";
    this.headerAnchors.contentEditable = "false";

    this.footerAnchors = document.createElement("div");
    this.footerAnchors.className = "paper-zone-anchors is-empty";
    this.footerAnchors.contentEditable = "false";

    this.root.append(
      // Behind-text layers FIRST: among positioned siblings with equal
      // stacking (z-index 0 vs auto), DOM order decides — first paints
      // lowest, so these sit under the text but over the paper white.
      this.anchorsBehind,
      this.headerAnchorsBehind,
      this.footerAnchorsBehind,
      this.header,
      this.content,
      this.footnotes,
      this.footer,
      this.anchors,
      this.headerAnchors,
      this.footerAnchors,
    );

    this.comments = document.createElement("div");
    this.comments.className = "paper-comments is-empty";
    this.comments.contentEditable = "false";

    this.outer.append(this.root, this.comments);
    container.appendChild(this.outer);
    this.applySetup(setup);
  }

  applySetup(setup: PageSetup): void {
    const { widthMM, heightMM } = resolvedDimensions(setup);
    const m = setup.margins;
    const s = this.root.style;
    s.width = `${widthMM}mm`;
    s.height = `${heightMM}mm`;
    s.setProperty("--margin-top", `${m.top}mm`);
    s.setProperty("--margin-right", `${m.right}mm`);
    s.setProperty("--margin-bottom", `${m.bottom}mm`);
    s.setProperty("--margin-left", `${m.left}mm`);
    applyVerticalAlign(this.content, setup.verticalAlign);
  }

  /**
   * Apply per-section settings on top of the base PageSetup. Currently
   * just `vAlign` — extends naturally to per-section page size, margins,
   * column counts, etc. when those land. Idempotent; called by
   * PaperStack after pagination distributes content.
   */
  applySectionOverride(section: SectionProperties): void {
    applyVerticalAlign(this.content, section.vAlign);
    // Header / footer offsets from `<w:pgMar w:header w:footer/>`.
    // Word positions the header text headerTwips from the page TOP,
    // and the body starts AT LEAST headerTwips + header content height
    // below the page top (whichever is more — body never sits under
    // the header). Tracked here as a CSS var so `applyZoneOverflowPadding`
    // can read it and ensure the body padding-top accommodates the
    // running header text + its top offset.
    const m = section.pageMargins;
    if (m?.headerTwips !== undefined) {
      const mm = (m.headerTwips / 1440) * 25.4;
      this.root.style.setProperty("--header-offset-mm", `${mm}mm`);
    }
    if (m?.footerTwips !== undefined) {
      const mm = (m.footerTwips / 1440) * 25.4;
      this.root.style.setProperty("--footer-offset-mm", `${mm}mm`);
    }
  }

  /**
   * Render the header zone from the rich AST. Uses the same `renderBlocks`
   * walker as body content so drawings, formatting, hyperlinks and
   * tables all carry through. `PAGE` / `NUMPAGES` field nodes are
   * substituted with this paper's page number / the total count.
   */
  setHeaderBlocks(ctx: ZoneRenderContext): void {
    renderZone(this.header, ctx);
    this.applyZoneOverflowPadding();
  }

  setFooterBlocks(ctx: ZoneRenderContext): void {
    renderZone(this.footer, ctx);
    this.applyZoneOverflowPadding();
  }

  /**
   * Paint the header zone's floating frames. Resolved against the header
   * flow (so `verticalFrom="paragraph"` anchors to a header paragraph).
   * Pass `[]` to clear. Mirrors `setAnchoredFrames` for body.
   */
  setHeaderFrames(frames: readonly AnchoredFrame[], ctx: AnchorLayerContext): void {
    const resolved = this.resolveFrames(frames, this.header);
    paintZoneFrames(
      this.headerAnchorsBehind,
      resolved.filter((f) => f.behindText),
      ctx,
    );
    paintZoneFrames(
      this.headerAnchors,
      resolved.filter((f) => !f.behindText),
      ctx,
    );
  }

  setFooterFrames(frames: readonly AnchoredFrame[], ctx: AnchorLayerContext): void {
    const resolved = this.resolveFrames(frames, this.footer);
    paintZoneFrames(
      this.footerAnchorsBehind,
      resolved.filter((f) => f.behindText),
      ctx,
    );
    paintZoneFrames(
      this.footerAnchors,
      resolved.filter((f) => !f.behindText),
      ctx,
    );
  }

  /**
   * Resolve each frame's `relativeFrom` origin to an absolute card-relative
   * position, returning clones whose `offsetX/YEmu` are the final
   * coordinates the (full-card, `inset:0`) overlay paints at. The pure
   * `resolveAnchorPosition` owns the semantics; here we just supply the
   * measured geometry: page margins (from the CSS vars) and — for
   * `verticalFrom="paragraph"` — the anchor paragraph's rendered top,
   * located within `zoneFlow` by the `data-block-index` `renderBlocks`
   * stamps. `offsetTop` is zoom-invariant in Chromium, so the measurement
   * stays logical at any render tier.
   */
  private resolveFrames(frames: readonly AnchoredFrame[], zoneFlow: HTMLElement): AnchoredFrame[] {
    // Margins come from the page-geometry CSS vars (the pgMar values),
    // NOT the overflow-adjusted `padding-top` — a `margin`-relative frame
    // anchors to the page margin, which a tall header doesn't move. px →
    // EMU keeps it consistent with the `offsetTop` measurements below.
    const marginTopEmu =
      parsePxFromMm(this.root.style.getPropertyValue("--margin-top")) * EMU_PER_PX;
    const marginLeftEmu =
      parsePxFromMm(this.root.style.getPropertyValue("--margin-left")) * EMU_PER_PX;
    return frames.map((f) => {
      let anchorParaTopEmu: number | null = null;
      if (f.anchor.verticalFrom === "paragraph" && f.anchor.paragraphIndex !== undefined) {
        const el = zoneFlow.querySelector<HTMLElement>(
          `[data-block-index="${f.anchor.paragraphIndex}"]`,
        );
        if (el) anchorParaTopEmu = offsetTopWithin(el, this.root) * EMU_PER_PX;
      }
      const { xEmu, yEmu } = resolveAnchorPosition(f, {
        marginTopEmu,
        marginLeftEmu,
        anchorParaTopEmu,
      });
      return { ...f, offsetXEmu: xEmu, offsetYEmu: yEmu };
    });
  }

  /**
   * When a rich header (or footer) renders taller than the page's
   * reserved margin, push body content out of the overlap.
   *
   * Word's behaviour: if header content exceeds `pgMar.top`, the body
   * yields downward. Same for footer + `pgMar.bottom`. Our paper
   * normally sets `padding-top: var(--margin-top)`; we override here to
   * `max(--margin-top, headerOffsetHeight)` (resp. for footer) so the
   * body's first paragraph never sits underneath the rendered header.
   *
   * The override is purely visual — the paginator still uses
   * `setup.margins.top/bottom` for its budget, so pages with very tall
   * headers may end up packing fewer body lines than expected. That's
   * a follow-up: feed the observed zone heights back into
   * `pageContentHeightPx` so pagination matches Word's effective body
   * area.
   */
  private applyZoneOverflowPadding(): void {
    const headerPx = this.header.offsetHeight;
    const footerPx = this.footer.offsetHeight;
    // Strip any prior override so the inline style doesn't beat the
    // CSS-var default when content shrinks back down to fit.
    this.root.style.removeProperty("padding-top");
    this.root.style.removeProperty("padding-bottom");
    const marginTopPx = parsePxFromMm(this.root.style.getPropertyValue("--margin-top"));
    const marginBottomPx = parsePxFromMm(this.root.style.getPropertyValue("--margin-bottom"));
    // Word's `<w:pgMar w:header>` reserves headerTwips of space ABOVE
    // the header text. Sobree's CSS `.paper-header` applies that via
    // `padding-top: var(--header-offset-mm, 12.7mm)`, which is
    // INCLUDED in `header.offsetHeight` — so the body just needs to
    // clear the header's actual rendered height, no extra add. (An
    // earlier version added headerOffsetPx on top of headerPx and
    // double-counted ~13mm per page, stealing ~25mm of body budget
    // and triggering systemic page-1 overflow on complex-multipage.)
    // Word's clearance rule is `headerOffset + header CONTENT height` vs
    // the top margin. The zone's offsetHeight additionally includes
    // Sobree's own decorative breathing pad (`.paper-header
    // { padding-bottom: 4mm }` / `.paper-footer { padding-top: 4mm }`) —
    // pure presentation inside the margin gap, NOT part of Word's
    // reservation. Counting it overstated the requirement by 4mm, so a
    // header that fits its margin in Word (offset + one line < margin)
    // still pushed the body down and stole ~15px of page budget.
    const headerReqPx =
      headerPx - (Number.parseFloat(getComputedStyle(this.header).paddingBottom) || 0);
    const footerReqPx =
      footerPx - (Number.parseFloat(getComputedStyle(this.footer).paddingTop) || 0);
    if (headerReqPx > marginTopPx + 1) {
      this.root.style.paddingTop = `${headerReqPx}px`;
    }
    if (footerReqPx > marginBottomPx + 1) {
      this.root.style.paddingBottom = `${footerReqPx}px`;
    }
  }

  /**
   * Plain-text fallback for callers that don't have rich blocks (legacy
   * page-setup modal templates that render to a single line of text).
   * Mirrors what `setHeaderBlocks` would do for an "x of y"-style
   * paragraph; kept as a separate method to keep the call sites obvious.
   */
  setHeaderText(text: string): void {
    setZoneText(this.header, text);
  }

  setFooterText(text: string): void {
    setZoneText(this.footer, text);
  }

  /**
   * Replace the anchor layer with frames whose anchor resolves to this
   * page. Idempotent — the old layer is wiped before painting the new
   * one. Pass `frames=[]` to clear the layer (sets `is-empty` so the
   * pointer-events-blocking overlay collapses out of the way).
   */
  setAnchoredFrames(frames: readonly AnchoredFrame[], ctx: AnchorLayerContext): void {
    const resolved = this.resolveFrames(frames, this.content);
    paintZoneFrames(
      this.anchorsBehind,
      resolved.filter((f) => f.behindText),
      ctx,
    );
    paintZoneFrames(
      this.anchors,
      resolved.filter((f) => !f.behindText),
      ctx,
    );
  }

  destroy(): void {
    this.outer.remove();
  }
}

/** Sum `offsetTop` up the `offsetParent` chain until `ancestor`, giving
 *  an element's top relative to that ancestor's padding box. `offsetTop`
 *  is logical-px (CSS `zoom` on an ancestor doesn't perturb it in
 *  Chromium), so the result is render-tier-independent. */
function offsetTopWithin(el: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== ancestor) {
    top += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return top;
}

const MM_TO_PX = 96 / 25.4;

function parsePxFromMm(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith("mm")) {
    const n = Number(trimmed.slice(0, -2));
    return Number.isFinite(n) ? n * MM_TO_PX : 0;
  }
  if (trimmed.endsWith("px")) {
    const n = Number(trimmed.slice(0, -2));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Lay out the content box for a section's vertical alignment.
 *
 * `top` (the default) keeps the CSS `display: flow-root` — one block
 * formatting context for the whole page body, so a floated image wraps
 * text across the FOLLOWING paragraphs and the paginator measures what it
 * renders. `center` / `bottom` / `both` need the free vertical space
 * redistributed, which a single BFC can't do, so those switch to a flex
 * column (a floated image in such a section then confines its wrap to the
 * anchor paragraph — a vanishingly rare combination).
 */
function applyVerticalAlign(el: HTMLElement, v: VerticalAlign | undefined): void {
  if (v === "center" || v === "bottom" || v === "both") {
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.justifyContent = justifyContentFor(v);
  } else {
    el.style.display = "";
    el.style.flexDirection = "";
    el.style.justifyContent = "";
  }
}

/**
 * Map a section vAlign to the matching `justify-content` value.
 *
 * `both` (OOXML's "justified") would need to redistribute paragraph
 * spacing — closer to `space-between` than to a single shift. `space-
 * between` keeps the visual outcome correct for the common case
 * (heading at top, last block at bottom) without rewriting any
 * paragraph margins.
 */
function justifyContentFor(v: VerticalAlign | undefined): string {
  switch (v) {
    case "center":
      return "center";
    case "bottom":
      return "flex-end";
    case "both":
      return "space-between";
    default:
      return "flex-start";
  }
}
