/**
 * Owns DrawingML text-wrapping: the `<wp:wrap*>` child of `<wp:anchor>`
 * that decides whether a frame DISPLACES body flow, and the `wrapText`
 * side that decides which way a floated frame goes. Wrap is an
 * anchored-drawing concept; inline drawings are in flow and carry none.
 */

import { NS } from "../shared/namespaces";

/** The mapped wrap mode, or the AST's value for an `<wp:anchor>` with no
 *  recognised wrap child. */
export type WrapType = "square" | "topAndBottom" | "tight" | "through" | "none";

/** Which sides of the frame body text flows on (`<wp:wrap* wrapText>`). */
export type WrapText = "bothSides" | "left" | "right" | "largest";

/**
 * The wrap mode lives as a dedicated child of `<wp:anchor>`:
 * `<wp:wrapSquare>`, `<wp:wrapTopAndBottom>`, `<wp:wrapTight>`,
 * `<wp:wrapThrough>`, or `<wp:wrapNone>`. Returns the mapped enum or
 * `undefined` when no wrap element is present.
 */
export function readWrapType(anchor: Element): WrapType | undefined {
  for (const child of Array.from(anchor.children)) {
    if (child.namespaceURI !== NS.wp) continue;
    switch (child.localName) {
      case "wrapSquare":
        return "square";
      case "wrapTopAndBottom":
        return "topAndBottom";
      case "wrapTight":
        return "tight";
      case "wrapThrough":
        return "through";
      case "wrapNone":
        return "none";
    }
  }
  return undefined;
}

/**
 * `wrapText` (`bothSides` / `left` / `right` / `largest`) lives on the
 * displacing wrap child (`<wp:wrapSquare|Tight|Through>`) and says which
 * sides of the frame text flows on. `topAndBottom` / `none` don't carry it.
 */
export function readWrapText(anchor: Element): WrapText | undefined {
  for (const child of Array.from(anchor.children)) {
    if (child.namespaceURI !== NS.wp) continue;
    if (
      child.localName === "wrapSquare" ||
      child.localName === "wrapTight" ||
      child.localName === "wrapThrough"
    ) {
      const v = child.getAttribute("wrapText");
      if (v === "left" || v === "right" || v === "bothSides" || v === "largest") return v;
    }
  }
  return undefined;
}
