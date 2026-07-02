/**
 * `<w:tabs>` reader — shared by direct paragraph formatting
 * (`<w:pPr><w:tabs>` in `paragraphs.ts`) and style definitions
 * (`<w:style><w:pPr><w:tabs>` in `styles.ts`). Word puts TOC-style
 * leader tabs on either level, so reading them only off direct pPr
 * silently dropped the stop geometry for styled paragraphs.
 */

import type { TabStop } from "../../doc/types";
import { wFirst } from "../shared/xml";

/** Read `<w:tabs>` under a `<w:pPr>` into `TabStop[]`; `undefined` when
 *  absent or empty. Values pass through verbatim (including
 *  `w:val="clear"` — consumers decide what a cleared stop means). */
export function readTabStops(pPr: Element): TabStop[] | undefined {
  const tabsEl = wFirst(pPr, "tabs");
  if (!tabsEl) return undefined;
  const stops: TabStop[] = [];
  for (const tab of Array.from(tabsEl.children)) {
    if (tab.namespaceURI !== tabsEl.namespaceURI || tab.localName !== "tab") continue;
    const posAttr = tab.getAttributeNS(tab.namespaceURI, "pos") ?? tab.getAttribute("w:pos");
    const valAttr = tab.getAttributeNS(tab.namespaceURI, "val") ?? tab.getAttribute("w:val");
    const leaderAttr =
      tab.getAttributeNS(tab.namespaceURI, "leader") ?? tab.getAttribute("w:leader");
    if (posAttr === null) continue;
    const pos = Number(posAttr);
    if (!Number.isFinite(pos)) continue;
    stops.push({
      positionTwips: pos,
      alignment: valAttr ?? "left",
      ...(leaderAttr ? { leader: leaderAttr } : {}),
    });
  }
  return stops.length > 0 ? stops : undefined;
}
