import { describe, expect, it } from "vitest";
import type { Page } from "../../pagination/types";
import { distributePages } from "./distribute";
import type { DomBox } from "./types";

/**
 * Row-content splitting: a `w:trHeight` minimum renders as CSS `height`
 * on the SOURCE row and is a minimum for the WHOLE row — per-page
 * fragment clones must NOT inherit it, or a split row re-applies the
 * full minimum on every page (snap-ed's 226mm scaffold row rendered
 * 3 × 855px and doubled the page count).
 */
describe("distributePages — split-row fragments", () => {
  it("drops the source row's height minimum from per-page TR clones", () => {
    const host = document.createElement("div");
    host.innerHTML = `<table data-pag-tid="t1"><tbody>
      <tr style="height: 226mm; background: red">
        <td><p id="a">first</p><p id="b">second</p></td>
        <td><p id="label">label</p></td>
      </tr>
    </tbody></table>`;
    document.body.appendChild(host);
    const tr = host.querySelector("tr") as HTMLElement;
    const [a, b] = [host.querySelector("#a"), host.querySelector("#b")] as HTMLElement[];

    const box = (el: HTMLElement, first: boolean): DomBox => ({
      type: "box",
      height: 100,
      el,
      cellTr: tr,
      isFirstLineOfParagraph: true,
      isLastLineOfParagraph: true,
      ...(first ? { isFirstParaOfRow: true } : {}),
    });
    // Two fragments: paragraph a on page 1, paragraph b on page 2.
    const pages: Page[] = [
      { items: [box(a!, true)], usedHeight: 100, cost: 0 },
      { items: [box(b!, false)], usedHeight: 100, cost: 0 },
    ];

    const perPage = distributePages(pages);

    const clones = perPage.map((els) => els[0]?.querySelector("tr") as HTMLElement);
    expect(clones).toHaveLength(2);
    for (const clone of clones) {
      expect(clone.style.height).toBe("");
      // Other styling survives — only the whole-row minimum is dropped.
      expect(clone.style.background).toBe("red");
    }
    expect(clones[0]?.textContent).toContain("first");
    expect(clones[0]?.textContent).toContain("label");
    expect(clones[1]?.textContent).toContain("second");
  });
});
