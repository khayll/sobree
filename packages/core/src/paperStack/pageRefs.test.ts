import { describe, expect, it } from "vitest";
import { fieldTarget } from "../doc/fields";
import { resolvePageRefFields } from "./paperZone";

function pageWith(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("fieldTarget", () => {
  it("takes the first non-switch token after the type", () => {
    expect(fieldTarget("PAGEREF _Toc1 \\h")).toBe("_Toc1");
    expect(fieldTarget(" PAGEREF _Toc42 \\h \\* MERGEFORMAT ")).toBe("_Toc42");
    expect(fieldTarget("PAGEREF")).toBeUndefined();
    expect(fieldTarget("PAGEREF \\h")).toBeUndefined();
  });
});

describe("resolvePageRefFields", () => {
  it("stamps each PAGEREF with the 1-based page of its bookmark", () => {
    const page1 = pageWith(
      '<p><span class="sobree-field" data-field="PAGEREF _Toc1 \\h">9</span>' +
        '<span class="sobree-field" data-field="PAGEREF _Toc2 \\h">9</span></p>',
    );
    const page2 = pageWith(
      '<p><span class="sobree-bookmark" data-bookmark-start="1" data-name="_Toc1"></span>One</p>',
    );
    const page3 = pageWith(
      '<p><span class="sobree-bookmark" data-bookmark-start="2" data-name="_Toc2"></span>Two</p>',
    );

    resolvePageRefFields([page1, page2, page3]);

    const [f1, f2] = Array.from(page1.querySelectorAll("[data-field]"));
    expect(f1?.textContent).toBe("2");
    expect(f2?.textContent).toBe("3");
  });

  it("leaves dangling targets and non-PAGEREF fields untouched", () => {
    const page1 = pageWith(
      '<p><span class="sobree-field" data-field="PAGEREF _Gone \\h">7</span>' +
        '<span class="sobree-field" data-field="PAGE">3</span>' +
        '<span class="sobree-bookmark" data-bookmark-start="1" data-name="_Here"></span></p>',
    );

    resolvePageRefFields([page1]);

    const [dangling, pageField] = Array.from(page1.querySelectorAll("[data-field]"));
    expect(dangling?.textContent).toBe("7");
    expect(pageField?.textContent).toBe("3");
  });

  it("uses the FIRST page holding the marker when a bookmark spans pages", () => {
    const marker =
      '<p><span class="sobree-bookmark" data-bookmark-start="1" data-name="_Span"></span>x</p>';
    const page1 = pageWith(marker);
    const page2 = pageWith(marker);
    const page3 = pageWith('<p><span class="sobree-field" data-field="PAGEREF _Span">0</span></p>');

    resolvePageRefFields([page1, page2, page3]);

    expect(page3.querySelector("[data-field]")?.textContent).toBe("1");
  });
});
