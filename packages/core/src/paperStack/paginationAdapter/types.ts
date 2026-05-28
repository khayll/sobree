import type { Box, Glue, Penalty } from "../../pagination/types";

/**
 * Box that carries the DOM element it came from. For multi-line paragraphs,
 * a single `<p>` contributes multiple DomBoxes — each with the same `el` and
 * a distinct `lineIndex`. For lists, a single `<ol>` / `<ul>` contributes
 * one DomBox per `<li>` child, each with the same `el` and a distinct
 * `liIndex` — the distribution step uses these to clone the parent list
 * and move tail `<li>`s into per-page fragments, mirroring how multi-line
 * paragraphs are split.
 */
export interface DomBox extends Box {
  el: HTMLElement;
  /** 0-based line within the paragraph, when `el` is a split paragraph. */
  lineIndex?: number;
  /** Total lines of the paragraph. */
  totalLines?: number;
  /** 0-based li index within an `<ol>` / `<ul>` parent, when `el` is the list. */
  liIndex?: number;
  /** Total `<li>` children in the parent list. */
  totalLis?: number;
  /** Source `<tr>` when this box represents a paragraph emitted by
   *  per-paragraph row-content splitting (tall rows). `el` points at the
   *  cell-level paragraph; `cellTr` lets `distributePages` clone the TR
   *  per page and route the paragraph into the matching cell clone. */
  cellTr?: HTMLElement;
  /** Marks the FIRST box of a tall row's per-paragraph stream so distribute
   *  can move non-dominant-cell content (labels, …) onto that fragment. */
  isFirstParaOfRow?: boolean;
}

export type DomItem = DomBox | Glue | Penalty;
