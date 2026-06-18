/**
 * Sobree dev playground — bare-bones surface for contributors.
 *
 * NOT the user-facing demo (that lives at sobree.dev/try). This is a
 * dev tool: edit anything in `packages/<pkg>/src/`, the playground
 * hot-reloads via the workspace symlinks + Vite HMR.
 */

import {
  type SobreeDocument,
  type Table,
  appendBlock,
  createSobree,
  defaultMargins,
  defaultStyles,
  heading,
  paragraph,
  parseMarkdown,
  text,
} from "@sobree/core";
import * as Y from "yjs";
import "@sobree/core/tokens.css";
import { blockTools } from "@sobree/block-tools";
import { attachIndexedDBProvider, attachWebsocketProvider } from "@sobree/collab-providers";
import { keyboard } from "@sobree/keyboard";
import { review } from "@sobree/review";
import { zoomControls } from "@sobree/zoom-controls";

import "./playground.css";

const host = resolveHost();

// The playground demos all three Sobree deployment tiers depending
// on URL query params:
//
//   (default)        — Tier 2.3 — IndexedDB-persisted, single tab
//   ?fresh           — Tier 1   — no persistence, fresh on every reload
//   ?mode=collab     — Tier 3   — talks to a local @sobree/collab-server
//                                 on ws://localhost:1234. Open in two
//                                 tabs and edits sync. Boot the server
//                                 + playground together with
//                                 `pnpm dev:collab`.
//
// All three end up calling `createSobree(host, { ydoc, ... })` — the
// only thing that differs is what Y provider attaches to the ydoc.
// That's the architectural payoff: app code is the same across
// solo / persisted / collab.
const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "local";
const ydoc = new Y.Doc();

let providerLabel = "no provider";

if (mode === "collab") {
  const room = params.get("room") ?? "default";
  const wsUrl = params.get("url") ?? "ws://localhost:1234";
  try {
    const handle = await attachWebsocketProvider(ydoc, {
      url: wsUrl,
      room,
      name: params.get("name") ?? "Anonymous",
      color: params.get("color") ?? "#f59e0b",
    });
    await handle.synced;
    providerLabel = `collab: ${wsUrl}/${room}`;
  } catch (err) {
    console.error("[playground] collab provider failed — is the server running?", err);
    providerLabel = `collab: connection failed (${String(err)})`;
  }
} else if (!params.has("fresh")) {
  // Default: IndexedDB persistence.
  try {
    const handle = await attachIndexedDBProvider(ydoc, {
      dbName: "sobree-playground",
    });
    await handle.synced;
    providerLabel = "IndexedDB";
  } catch (err) {
    console.warn("[playground] IndexedDB persistence unavailable:", err);
  }
} else {
  providerLabel = "fresh (no persistence)";
}

const ydocHasContent = ydoc.getArray("body").length > 0;

// Show the active provider in the page header so it's obvious what
// the playground is doing right now.
const headerHint = document.querySelector(".bar .hint");
if (headerHint) {
  const note = document.createElement("span");
  note.style.cssText = "margin-left: 1em; opacity: 0.6;";
  note.textContent = `[${providerLabel}]`;
  headerHint.appendChild(note);
}

// `@sobree/core` ships zero plugin packages. The playground opts into
// the three "interactive editor" plugins: keyboard shortcuts, the
// floating block toolbar, and the zoom dock. We override the zoom
// dock's `fitPageTarget` so it lands on whichever paper is under the
// viewport's centre instead of always the first paper — feels right
// when the user is scrolled deep into a multi-page doc.
const editor = createSobree(host, {
  // If the Y.Doc was hydrated from IndexedDB, skip `content` — the
  // Editor adopts the existing state. Otherwise seed with the
  // example doc.
  ...(ydocHasContent ? {} : { content: simpleSeed() }),
  ydoc,
  // Show the @sobree/core version badge in the dev playground so the
  // rendered build is always identifiable.
  versionBadge: true,
  plugins: [
    keyboard(),
    blockTools(),
    zoomControls({ fitPageTarget: () => paperAtViewportCenter() }),
    review(),
  ],
});

// Dev-only window handle for poking the API from the browser console.
// Stripped from production builds — Vite removes the import.meta.env.DEV
// branch in `vite build`.
if (import.meta.env.DEV) {
  (window as unknown as { sobree: unknown }).sobree = editor;
  (window as unknown as { sobreeYDoc: unknown }).sobreeYDoc = editor.ydoc;
  (window as unknown as { sobreeMode: unknown }).sobreeMode = mode;
  // Convergence tooling — invoked from the browser console (or via
  // remote eval). Implements the loop documented in
  // tests/corpus/CONVERGENCE.md. See `extractSobreeLines` and
  // `convergenceReport` below.
  (window as unknown as { convergenceReport: unknown }).convergenceReport = convergenceReport;
  (window as unknown as { ooxmlBlame: unknown }).ooxmlBlame = ooxmlBlame;
}

// =====================================================================
// Convergence tooling — keeps fixture rendering on-track via objective
// per-line measurements instead of screenshot whack-a-mole. Doc:
// tests/corpus/CONVERGENCE.md.
// =====================================================================

interface ExtractedLine {
  text: string;
  xPt: number;
  yPt: number;
  pageIndex: number;
  blockIndex?: number;
}

interface LoMetricsLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
}

interface LoMetrics {
  fixture: string;
  pdfSizePt: { width: number; height: number };
  pages: Array<{ page: number; lines: LoMetricsLine[] }>;
}

interface PerPageDelta {
  page: number;
  loLines: number;
  sobreeLines: number;
  matched: number;
  medDx: number;
  medDy: number;
  p95Dy: number;
  maxDy: number;
  worst: Array<{
    dx: number;
    dy: number;
    text: string;
    loY: number;
    sobreeY: number;
    page: number;
    blockIndex?: number | undefined;
  }>;
}

const PT_PER_PX = 72 / 96;

/**
 * Walk every `.paper-content` in document order and emit one
 * `ExtractedLine` per visual text line — including wrapped lines —
 * with PDF-style coordinates (pt from page LEFT, pt from page
 * BOTTOM) so we can diff against LibreOffice's metrics.json.
 *
 * Important: the viewport applies a CSS `transform: scale()` to
 * the rendered stack. `getBoundingClientRect` returns SCALED
 * viewport pixels, but `paper.offsetHeight` returns layout-space
 * CSS pixels (zoom doesn't affect layout). To compare to LO's
 * absolute PDF coordinates we measure the per-paper viewport
 * scale (rect height vs offsetHeight) and unscale before
 * converting to pt.
 */
function extractSobreeLines(): ExtractedLine[] {
  const out: ExtractedLine[] = [];
  const stack = editor.sobree.stackRoot;
  const papers = Array.from(stack.querySelectorAll<HTMLElement>(".paper"));
  for (let pi = 0; pi < papers.length; pi++) {
    const paper = papers[pi]!;
    const paperRect = paper.getBoundingClientRect();
    const paperHeightPt = paper.offsetHeight * PT_PER_PX;
    // Per-paper viewport zoom scale — `getBoundingClientRect()`
    // returns scaled pixels but we want layout pixels for the diff.
    const zoomScale = paper.offsetHeight > 0 ? paperRect.height / paper.offsetHeight : 1;
    const safeScale = zoomScale > 0 ? zoomScale : 1;
    const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return (node.textContent ?? "").trim().length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = n as Text;
      const range = document.createRange();
      range.selectNodeContents(text);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      // Reconstruct text per visual line by chunking the text node's
      // characters into ranges that share a clientRect top.
      if (rects.length === 0) continue;
      const fullText = text.textContent ?? "";
      // Per-rect text extraction: for each visual line rect, slice
      // the chars whose individual ranges share that rect's top.
      // Cheaper alternative when accuracy isn't critical: just use
      // the whole text and the first rect.
      // We pick a hybrid: associate full text with the topmost rect
      // (which is usually the only one for short texts), and for
      // multi-rect texts, split chars per rect.
      if (rects.length === 1) {
        const r = rects[0]!;
        // Unscale the viewport-pixel offsets so they're in layout
        // CSS pixels, then convert to pt.
        const xPt = ((r.left - paperRect.left) / safeScale) * PT_PER_PX;
        const yPt = paperHeightPt - ((r.top + r.height - paperRect.top) / safeScale) * PT_PER_PX;
        const blockIndex = findTopLevelBlockIndex(text, paper);
        out.push({
          text: fullText.replace(/\s+/g, " ").trim(),
          xPt,
          yPt,
          pageIndex: pi,
          ...(blockIndex !== undefined ? { blockIndex } : {}),
        });
      } else {
        // Multi-rect = wrapped text. Bucket chars into visual lines
        // by walking the text node char-by-char and grouping by
        // matching y-position.
        let charStart = 0;
        for (const rect of rects) {
          let charEnd = charStart;
          for (let i = charStart; i < fullText.length; i++) {
            const subRange = document.createRange();
            subRange.setStart(text, i);
            subRange.setEnd(text, Math.min(i + 1, fullText.length));
            const cr = subRange.getBoundingClientRect();
            if (Math.abs(cr.top - rect.top) > 2) break;
            charEnd = i + 1;
          }
          if (charEnd > charStart) {
            const lineText = fullText.slice(charStart, charEnd).replace(/\s+/g, " ").trim();
            if (lineText) {
              const xPt = (rect.left - paperRect.left) * PT_PER_PX;
              const yPt = paperHeightPt - (rect.top + rect.height - paperRect.top) * PT_PER_PX;
              const blockEl = (text.parentElement?.closest("[data-block-index]") ??
                null) as HTMLElement | null;
              const blockIndex = blockEl?.dataset.blockIndex
                ? Number(blockEl.dataset.blockIndex)
                : undefined;
              out.push({
                text: lineText,
                xPt,
                yPt,
                pageIndex: pi,
                ...(blockIndex !== undefined ? { blockIndex } : {}),
              });
            }
          }
          charStart = charEnd;
          if (charStart >= fullText.length) break;
        }
      }
    }
  }
  return out;
}

/**
 * Walk up from a text node and return the block-index of the
 * TOP-LEVEL body block that contains it — i.e. the ancestor whose
 * own parent is `.paper-content`. Nested elements (table cells,
 * list items inside a cell, lifted-textbox paragraphs) all carry
 * their own `data-block-index` from when the renderer recursed via
 * `renderBlocks(cell.content, …)`, so a naive `closest()` returns
 * a cell-local index rather than the body block.
 */
function findTopLevelBlockIndex(text: Text, paper: HTMLElement): number | undefined {
  const paperContent = paper.querySelector(".paper-content");
  if (!paperContent) return undefined;
  let el: Element | null = text.parentElement;
  let candidate: HTMLElement | undefined;
  while (el && el !== paperContent) {
    if (el instanceof HTMLElement && el.dataset.blockIndex !== undefined) {
      candidate = el;
    }
    if (el.parentElement === paperContent) break;
    el = el.parentElement;
  }
  if (el !== paperContent || !candidate) return undefined;
  // Use the OUTERMOST block-index we found while walking up (the
  // last assignment to `candidate`), which is the body-block.
  // Actually `candidate` ends up being the LAST stamped element on
  // the way up — that's the outermost. Confirm by ensuring it sits
  // directly inside .paper-content.
  let top: Element | null = candidate;
  while (top?.parentElement && top.parentElement !== paperContent) {
    top = top.parentElement;
  }
  if (!(top instanceof HTMLElement) || top.dataset.blockIndex === undefined) {
    return undefined;
  }
  const n = Number(top.dataset.blockIndex);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Substring-aware text similarity in [0, 1]. Mirrors the algorithm
 * in `tools/fixtures-gen/src/corpus/layoutDelta.ts` so the browser-
 * side report uses the same matching logic as the CLI.
 */
function textSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = a.toLowerCase().replace(/\s+/g, " ").trim();
  const B = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (A === B) return 1;
  const [shorter, longer] = A.length <= B.length ? [A, B] : [B, A];
  if (longer.includes(shorter) && shorter.length >= 8) {
    return shorter.length / longer.length;
  }
  let common = 0;
  const bag: Record<string, number> = {};
  for (const c of shorter) bag[c] = (bag[c] ?? 0) + 1;
  for (const c of longer) {
    if ((bag[c] ?? 0) > 0) {
      common++;
      bag[c] = (bag[c] ?? 0) - 1;
    }
  }
  return common / Math.max(A.length, B.length);
}

/**
 * Per-page delta computation. For each LO line we find the closest
 * Sobree line on the same page (text-similarity ≥ 0.7) and record
 * the deltas. Returns aggregate stats plus the top-10 worst by |dy|.
 */
function computeReport(
  loMetrics: LoMetrics,
  sobreeLines: ExtractedLine[],
): { perPage: PerPageDelta[]; pageCountSobree: number; pageCountLo: number } {
  const pageCountLo = loMetrics.pages.length;
  const pageCountSobree = new Set(sobreeLines.map((l) => l.pageIndex)).size;
  const perPage: PerPageDelta[] = [];
  for (let i = 0; i < pageCountLo; i++) {
    const loPage = loMetrics.pages[i];
    if (!loPage) continue;
    const sobreePage = sobreeLines.filter((l) => l.pageIndex === i);
    const matches: Array<{
      dx: number;
      dy: number;
      text: string;
      loY: number;
      sobreeY: number;
      blockIndex?: number | undefined;
    }> = [];
    for (const lo of loPage.lines) {
      let best: ExtractedLine | null = null;
      let bestSim = 0;
      for (const so of sobreePage) {
        const sim = textSim(lo.text, so.text);
        if (sim > bestSim) {
          bestSim = sim;
          best = so;
        }
      }
      if (best && bestSim >= 0.7) {
        matches.push({
          dx: Math.round(best.xPt - lo.x),
          dy: Math.round(best.yPt - lo.y),
          text: lo.text.slice(0, 60),
          loY: Math.round(lo.y),
          sobreeY: Math.round(best.yPt),
          ...(best.blockIndex !== undefined ? { blockIndex: best.blockIndex } : {}),
        });
      }
    }
    const ys = matches.map((m) => m.dy).sort((a, b) => a - b);
    const xs = matches.map((m) => m.dx).sort((a, b) => a - b);
    const median = (arr: number[]) =>
      arr.length === 0 ? 0 : (arr[Math.floor(arr.length / 2)] ?? 0);
    const p95 = (arr: number[]) => {
      const abs = arr.map(Math.abs).sort((a, b) => a - b);
      return abs.length === 0 ? 0 : (abs[Math.floor(abs.length * 0.95)] ?? 0);
    };
    const maxAbs = (arr: number[]) => arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const worst = matches
      .slice()
      .sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy))
      .slice(0, 10)
      .map((m) => ({ ...m, page: i + 1 }));
    perPage.push({
      page: i + 1,
      loLines: loPage.lines.length,
      sobreeLines: sobreePage.length,
      matched: matches.length,
      medDx: median(xs),
      medDy: median(ys),
      p95Dy: p95(ys),
      maxDy: maxAbs(ys),
      worst,
    });
  }
  return { perPage, pageCountSobree, pageCountLo };
}

/**
 * Browser-callable convergence report. Loads LO metrics.json over
 * fetch, extracts Sobree lines from the current render, runs the
 * delta computation, returns a plain JSON-able report object.
 *
 * Usage from console (or remote eval):
 *   await window.convergenceReport("complex-multipage")
 */
async function convergenceReport(slug = "complex-multipage"): Promise<unknown> {
  const metricsUrl = `/__corpus/${slug}/libreoffice/metrics.json`;
  let metrics: LoMetrics;
  try {
    const res = await fetch(metricsUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    metrics = (await res.json()) as LoMetrics;
  } catch (err) {
    return { error: `failed to load ${metricsUrl}: ${(err as Error).message}` };
  }
  const sobreeLines = extractSobreeLines();
  const report = computeReport(metrics, sobreeLines);
  const overall = aggregateOverall(report.perPage);
  return {
    slug,
    pageCount: { sobree: report.pageCountSobree, lo: report.pageCountLo },
    overall,
    perPage: report.perPage.map((p) => ({
      page: p.page,
      lines: { lo: p.loLines, sobree: p.sobreeLines, matched: p.matched },
      medDx: p.medDx,
      medDy: p.medDy,
      p95Dy: p.p95Dy,
      maxDy: p.maxDy,
    })),
    worst20: report.perPage
      .flatMap((p) => p.worst)
      .sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy))
      .slice(0, 20),
  };
}

function aggregateOverall(perPage: PerPageDelta[]) {
  const allMatched = perPage.flatMap((p) =>
    p.worst.length === 0 && p.matched === 0 ? [] : [{ matched: p.matched }],
  );
  const totalMatched = perPage.reduce((s, p) => s + p.matched, 0);
  const totalLoLines = perPage.reduce((s, p) => s + p.loLines, 0);
  const medianOf = (vals: number[]) => {
    if (vals.length === 0) return 0;
    const s = vals.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  return {
    matchedPct: totalLoLines === 0 ? 0 : Math.round((totalMatched / totalLoLines) * 100),
    medDyPerPage: medianOf(perPage.map((p) => p.medDy)),
    medDxPerPage: medianOf(perPage.map((p) => p.medDx)),
    p95DyAcrossPages: medianOf(perPage.map((p) => p.p95Dy)),
    maxDyAcrossPages: Math.max(0, ...perPage.map((p) => p.maxDy)),
    matchedCount: totalMatched,
    loLineCount: totalLoLines,
    _allMatched: allMatched.length,
  };
}

/**
 * Inspect a specific body block: dumps its source XML region, the
 * parsed AST node, and the rendered DOM with computed styles. Use
 * when the convergence report flags a worst-N line — paste its
 * blockIndex here to see the data flow.
 *
 * Usage: window.ooxmlBlame(42)
 */
function ooxmlBlame(blockIndex: number) {
  const doc = editor.getDocument();
  const block = doc.body[blockIndex];
  const renderedEl = editor.sobree.stackRoot.querySelector<HTMLElement>(
    `[data-block-index="${blockIndex}"]`,
  );
  const computed = renderedEl
    ? Object.fromEntries(
        [
          "padding",
          "margin",
          "textIndent",
          "lineHeight",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "color",
          "background",
        ].map((k) => [k, getComputedStyle(renderedEl)[k as keyof CSSStyleDeclaration]]),
      )
    : null;
  return {
    blockIndex,
    block,
    rendered: renderedEl
      ? {
          tag: renderedEl.tagName,
          className: renderedEl.className,
          outerHTML: renderedEl.outerHTML.slice(0, 400),
          computed,
          rect: renderedEl.getBoundingClientRect(),
        }
      : "no rendered element with this data-block-index",
  };
}

function resolveHost(): HTMLElement {
  const el = document.getElementById("editor");
  if (!(el instanceof HTMLElement)) throw new Error("missing #editor host");
  return el;
}

/** Paper whose vertical range contains the viewport's centre Y.
 *  Falls back to the paper with the nearest edge if none contains it. */
function paperAtViewportCenter(): HTMLElement {
  const vp = host.getBoundingClientRect();
  const cy = vp.top + vp.height / 2;
  const papers = Array.from(editor.sobree.stackRoot.querySelectorAll(".paper")) as HTMLElement[];
  if (papers.length === 0) return editor.sobree.firstPaper;
  let best = papers[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of papers) {
    const r = p.getBoundingClientRect();
    if (cy >= r.top && cy <= r.bottom) return p;
    const d = Math.min(Math.abs(r.top - cy), Math.abs(r.bottom - cy));
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ?? editor.sobree.firstPaper;
}

// === live-state panel ===

const blocksOut = document.getElementById("meta-blocks");
const pagesOut = document.getElementById("meta-pages");
const revOut = document.getElementById("meta-rev");
const docPre = document.getElementById("doc-pre");

let revision = 0;

editor.on("change", ({ doc }) => {
  revision += 1;
  if (blocksOut) blocksOut.textContent = String(doc.body.length);
  if (revOut) revOut.textContent = String(revision);
  if (docPre) docPre.textContent = JSON.stringify(doc, jsonReplacer, 2);
});

editor.on("paginate", ({ pageCount }) => {
  if (pagesOut) pagesOut.textContent = String(pageCount);
});

// Seed initial state on the panel.
queueMicrotask(() => {
  const doc = editor.getDocument();
  if (blocksOut) blocksOut.textContent = String(doc.body.length);
  if (docPre) docPre.textContent = JSON.stringify(doc, jsonReplacer, 2);
});

// === mode + track-changes switches ===
//
// These mirror two pieces of editor state in the right-panel UI:
//
//   - `Sobree.setMode("edit" | "read")` — drives `contenteditable`
//     across all content hosts. The switch is bi-directional: clicking
//     it writes through; an external `mode-change` event paints it
//     back in sync.
//
//   - `editor.setTrackChanges({ enabled, author? })` — flips the
//     authoring mode. The author input only appears when track changes
//     is on; empty input means "anonymous" (no author field).

const editCheckbox = document.getElementById("mode-edit");
if (editCheckbox instanceof HTMLInputElement) {
  // Initial state mirrors `getMode()` so the playground reflects whatever
  // mode the editor came up in.
  editCheckbox.checked = editor.sobree.getMode() === "edit";
  editCheckbox.addEventListener("change", () => {
    editor.sobree.setMode(editCheckbox.checked ? "edit" : "read");
  });
  editor.sobree.on("mode-change", ({ mode }) => {
    editCheckbox.checked = mode === "edit";
  });
}

const tcCheckbox = document.getElementById("mode-track-changes");
const tcAuthorRow = document.getElementById("author-row");
const tcAuthorInput = document.getElementById("tc-author");
if (
  tcCheckbox instanceof HTMLInputElement &&
  tcAuthorRow instanceof HTMLElement &&
  tcAuthorInput instanceof HTMLInputElement
) {
  const syncFromState = () => {
    const state = editor.editor.getTrackChanges();
    tcCheckbox.checked = state.enabled;
    tcAuthorRow.hidden = !state.enabled;
    // Don't stomp the user's in-progress typing — only refresh the
    // input from external state when it's not focused.
    if (document.activeElement !== tcAuthorInput) {
      tcAuthorInput.value = state.author ?? "";
    }
  };
  syncFromState();

  tcCheckbox.addEventListener("change", () => {
    const author = tcAuthorInput.value.trim();
    editor.editor.setTrackChanges(
      tcCheckbox.checked
        ? author === ""
          ? { enabled: true }
          : { enabled: true, author }
        : { enabled: false },
    );
  });

  tcAuthorInput.addEventListener("input", () => {
    const cur = editor.editor.getTrackChanges();
    const author = tcAuthorInput.value.trim();
    editor.editor.setTrackChanges(
      author === "" ? { enabled: cur.enabled } : { enabled: cur.enabled, author },
    );
  });

  // The façade re-emits the editor's event; subscribe there so the UI
  // catches flips made via `sobree.setTrackChanges(...)` too.
  editor.sobree.on("track-changes-change", syncFromState);
}

// Hidden-text reveal toggle (`<w:vanish/>`). Off by default (print view);
// on reveals hidden runs with a dotted underline so they're editable.
const showHiddenCheckbox = document.getElementById("mode-show-hidden");
if (showHiddenCheckbox instanceof HTMLInputElement) {
  showHiddenCheckbox.addEventListener("change", () => {
    editor.setShowHiddenText(showHiddenCheckbox.checked);
  });
}

// === actions ===

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    switch (action) {
      case "seed-simple":
        editor.loadMarkdown(simpleSeed());
        break;
      case "seed-rich":
        editor.setDocument(richSeed());
        break;
      case "seed-multipage":
        editor.loadMarkdown(multiPageSeed());
        break;
      case "seed-a5":
        editor.setDocument(a5Seed());
        break;
      case "clear":
        editor.loadMarkdown("");
        break;
      case "export-docx":
        downloadDocx();
        break;
    }
  });
}

const fileInput = document.getElementById("file-input");
if (fileInput instanceof HTMLInputElement) {
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const { warnings } = await editor.loadDocx(file);
      if (warnings.length) console.warn("import warnings:", warnings);
    } catch (err) {
      console.error("docx import failed:", err);
      alert(`docx import failed: ${(err as Error).message}`);
    }
  });
}

function downloadDocx(): void {
  const { blob, warnings } = editor.toDocx();
  if (warnings.length) console.warn("export warnings:", warnings);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: "playground.docx",
  });
  a.click();
  URL.revokeObjectURL(url);
}

// === seed templates ===

function simpleSeed(): string {
  return `# Sobree dev playground

Click anywhere and start typing. The right pane shows the live AST + revision counter.

Use the buttons on the right to swap seeds, load a .docx, or download the current document.`;
}

function richSeed(): SobreeDocument {
  const doc = parseMarkdown(`# Q2 product brief

This is a **bold** sentence with *italic*, \`inline code\`, and a [link](https://sobree.dev).

## Goals

- Ship the editor
- Round-trip .docx faithfully
- Keep the core framework-free

## Non-goals

1. Replicating every Word feature
2. Building a CMS

## Status by quarter

The table below tracks delivery against the goals above.`);

  // Three-column header + three data rows. Column widths in twips:
  // ~A4 content width (9000) split roughly 40 / 30 / 30.
  appendBlock(doc, demoTable());

  appendBlock(doc, paragraph([text("Two-space hard breaks work like the rest of Sobree.")]));

  // Hidden text (`<w:vanish/>`) — invisible until "Show hidden text" is on.
  appendBlock(
    doc,
    paragraph([
      text("There is a "),
      text("hidden editorial note", { hidden: true }),
      text(" in this paragraph — toggle “Show hidden text” to reveal it."),
    ]),
  );

  return doc;
}

function demoTable(): Table {
  const rows = [
    headerRow(["Goal", "Quarter", "Status"]),
    bodyRow(["Ship the editor", "Q2", "On track"]),
    bodyRow([".docx round-trip", "Q2", "On track"]),
    bodyRow(["Framework-free core", "Q1", "Done"]),
  ];
  return {
    kind: "table",
    grid: [3600, 2700, 2700],
    rows,
    properties: { styleId: "TableGrid" },
  };
}

function headerRow(cells: string[]): Table["rows"][number] {
  return {
    isHeader: true,
    cells: cells.map((label) => ({
      content: [paragraph([text(label, { bold: true })])],
    })),
  };
}

function bodyRow(cells: string[]): Table["rows"][number] {
  return {
    cells: cells.map((label) => ({
      content: [paragraph([text(label)])],
    })),
  };
}

/** A5 portrait, two pages — page 1 intro + page break + page 2 content.
 *  A5 is half of A4: 148 × 210 mm, which is 8391 × 11906 twips. */
function a5Seed(): SobreeDocument {
  const A5_WIDTH_TWIPS = 8391;
  const A5_HEIGHT_TWIPS = 11906;

  return {
    body: [
      heading(1, [text("A5 example")]),
      paragraph([
        text(
          "This is the A5 page size: 148 × 210 mm — half the surface area " +
            "of A4. Common for booklets, notebooks, and pocket-sized prints.",
        ),
      ]),
      heading(2, [text("Two pages")]),
      paragraph([
        text(
          "The next paragraph ends with a forced page break, so the rest " +
            "of the content lands on page 2. The paginator handles forced " +
            "breaks the same as natural ones — selection, undo, and " +
            "rendering all stay consistent.",
        ),
      ]),
      paragraph([text("End of page 1.")]),
      heading(1, [text("Page 2")], { pageBreakBefore: true }),
      paragraph([
        text(
          "Page 2 begins here. Edit anything; the paginator re-runs and " +
            "re-flows on every change.",
        ),
      ]),
      paragraph([
        text(
          "Try shrinking the right pane or zooming with the dock " +
            "(bottom-right) — the A5 paper stays at its real proportions, " +
            "the viewport just scales the view.",
        ),
      ]),
    ],
    sections: [
      {
        pageSize: {
          wTwips: A5_WIDTH_TWIPS,
          hTwips: A5_HEIGHT_TWIPS,
          orientation: "portrait",
        },
        pageMargins: defaultMargins(),
        headerRefs: [],
        footerRefs: [],
      },
    ],
    headerFooterBodies: {},
    styles: defaultStyles(),
    numbering: [],
    rawParts: {},
    fonts: [],
  };
}

function multiPageSeed(): string {
  const lorem =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. " +
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. ";
  const paragraphs: string[] = ["# Multi-page test"];
  for (let i = 1; i <= 30; i++) {
    paragraphs.push(`### Section ${i}`);
    paragraphs.push(lorem.repeat(3));
  }
  return paragraphs.join("\n\n");
}

// === helpers ===

/**
 * Strip the binary `rawParts` blob from the JSON dump — it serializes
 * as a giant `{}`, useless for inspection.
 */
function jsonReplacer(key: string, value: unknown): unknown {
  if (key === "rawParts") return "[stripped]";
  return value;
}
