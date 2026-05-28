/**
 * Measure the individual line boxes of a paragraph-like element using
 * `Range.getClientRects()`. The returned metrics let the paginator treat
 * each line as its own `Box` so widow/orphan rules can act per line.
 *
 * Fast path uses binary search — O(L · log N) per paragraph for L lines
 * and N characters (versus O(N) for a per-character linear walk).
 */

export interface LineMetric {
  lineIndex: number;
  /** Natural height of the line box in CSS px. */
  height: number;
  /** Character offset within the element where the line starts. */
  startCharOffset: number;
  /** Character offset (exclusive) where the line ends. */
  endCharOffset: number;
}

export function measureParagraphLines(el: HTMLElement): LineMetric[] {
  const totalChars = countTextChars(el);
  if (totalChars === 0) {
    return [
      {
        lineIndex: 0,
        height: el.getBoundingClientRect().height,
        startCharOffset: 0,
        endCharOffset: 0,
      },
    ];
  }

  const range = document.createRange();
  range.selectNodeContents(el);
  // jsdom's Range stub doesn't implement `getClientRects` — tests that
  // exercise the paginator (collab-providers loopback, oracle) would
  // otherwise throw and surface as listener errors. Fall back to a
  // single line box using `offsetHeight` when the method is missing;
  // the resulting metrics aren't useful for layout (jsdom doesn't run
  // layout anyway) but they're enough to keep the pipeline running.
  const getRects = (range as Range & { getClientRects?: () => DOMRectList }).getClientRects;
  if (typeof getRects !== "function") {
    return [
      {
        lineIndex: 0,
        height: el.offsetHeight,
        startCharOffset: 0,
        endCharOffset: totalChars,
      },
    ];
  }
  const lines = clusterLineRects(Array.from(range.getClientRects()));
  // `offsetHeight` is in LOGICAL px (unaffected by CSS transforms on an
  // ancestor viewport). `getBoundingClientRect()` is post-transform — mixing
  // the two with a logical `pageContentHeight` mis-packs pages at any zoom.
  const logicalHeight = el.offsetHeight;
  if (lines.length <= 1) {
    return [
      {
        lineIndex: 0,
        height: logicalHeight,
        startCharOffset: 0,
        endCharOffset: totalChars,
      },
    ];
  }

  const starts: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    starts.push(findLineStartOffset(el, i, totalChars));
  }

  // Distribute the paragraph's logical height uniformly across clustered
  // lines. Sum always equals `offsetHeight` exactly, so the paginator can't
  // overfill or underfill due to scale mismatches.
  const lineHeight = logicalHeight / lines.length;
  return lines.map((_l, i) => ({
    lineIndex: i,
    height: lineHeight,
    startCharOffset: starts[i] ?? 0,
    endCharOffset: starts[i + 1] ?? totalChars,
  }));
}

/** Find the character in `el` at which line `targetLine` (1-based) begins. */
function findLineStartOffset(el: HTMLElement, targetLine: number, totalChars: number): number {
  // `lo` converges to the smallest offset where range [0, offset) covers
  // `targetLine + 1` line boxes — i.e. (first char of line targetLine) + 1.
  // Return `lo - 1` so the offset IS the first char of the target line.
  const range = document.createRange();
  let lo = 1;
  let hi = totalChars;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (countLinesUpTo(el, mid, range) > targetLine) hi = mid;
    else lo = mid + 1;
  }
  return Math.max(0, lo - 1);
}

function countLinesUpTo(el: HTMLElement, charOffset: number, range: Range): number {
  const pos = nodeAtCharOffset(el, charOffset);
  if (!pos) return 1;
  range.setStart(el, 0);
  range.setEnd(pos.node, pos.offset);
  return clusterLineRects(Array.from(range.getClientRects())).length;
}

/** Resolve a character offset (0-based, counting only text chars) to (textNode, nodeOffset). */
export function nodeAtCharOffset(
  el: HTMLElement,
  charOffset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (total + node.length >= charOffset) {
      return { node, offset: charOffset - total };
    }
    total += node.length;
    node = walker.nextNode() as Text | null;
  }
  // charOffset points past the last char — return end of last text node.
  const last = el.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) {
    const t = last as Text;
    return { node: t, offset: t.length };
  }
  return null;
}

function countTextChars(el: HTMLElement): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    total += node.length;
    node = walker.nextNode() as Text | null;
  }
  return total;
}

/**
 * Cluster a list of client rects into distinct lines by rounded `top`.
 * Rich content (spans, italics, descenders) on the same visual line
 * can produce rects whose tops drift by 1-2px due to glyph-metric
 * differences. The tolerance has to be loose enough to absorb that
 * drift but tighter than the smallest reasonable line-height; 5px
 * covers sub-pixel jitter without ever merging adjacent lines (the
 * tightest CSS line-height the renderer emits is ~14px at 11pt body).
 *
 * Why this matters: when sibling rects on the same line round to
 * consecutive integers (e.g. 2717 and 2718), a strict `< 1` tolerance
 * counts them as separate lines, inflating `lines.length`. The
 * paginator then divides `offsetHeight` by the inflated count and
 * under-measures every line — pages overflow because each per-line
 * box is recorded smaller than its rendered size. Observed on
 * user-contract page 3 (an LI with 10 visual lines clustered as 12
 * → 35pt under-measurement → page overflow).
 */
function clusterLineRects(rects: DOMRect[]): Array<{ top: number; bottom: number }> {
  const lines: Array<{ top: number; bottom: number }> = [];
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue;
    const key = Math.round(r.top);
    const existing = lines.find((l) => Math.abs(l.top - key) <= LINE_CLUSTER_TOL_PX);
    if (existing) {
      existing.bottom = Math.max(existing.bottom, r.bottom);
    } else {
      lines.push({ top: key, bottom: r.bottom });
    }
  }
  return lines.sort((a, b) => a.top - b.top);
}

const LINE_CLUSTER_TOL_PX = 5;
