import { describe, expect, it } from "vitest";
import type { InlinePosition } from "../doc/api";
import { emptyDocument, heading, paragraph, text } from "../doc/builders";
import type { SobreeDocument } from "../doc/types";
import { Editor } from "./";
import type { EditorContext } from "./context";
import * as runs from "./ops/runs";
import { renderSobreeDocument } from "./view/docRenderer/index";

/**
 * Perf bench / fitness baseline for the model-first editing work
 * (`devdocs/plan-model-first-editing.md`, Stage 1 — incremental render).
 *
 * It measures a DETERMINISTIC proxy for render cost — how many block DOM
 * elements a single-block edit RE-CREATES vs reuses — by comparing element
 * identity across the re-render. Wall-clock timing would be flaky in CI;
 * node identity is exact.
 *
 * A single-block edit must reuse every OTHER block's DOM node (reused ===
 * N − 1) — only the edited block is re-rendered. This is the guard for the
 * incremental render (PR 2): a regression back to the full `replaceChildren`
 * rebuild would drop `reused` to 0 and fail here.
 */

const N = 25;

function longDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = Array.from({ length: N }, (_, i) => paragraph([text(`Paragraph number ${i}.`)]));
  return d;
}

/** `data-block-id` → its rendered element, across all content hosts. */
function blockEls(ed: Editor): Map<string, Element> {
  const host = (ed as unknown as { host: HTMLElement }).host;
  const map = new Map<string, Element>();
  for (const el of host.querySelectorAll("[data-block-id]")) {
    const id = el.getAttribute("data-block-id");
    // Only top-level blocks (a table cell's paragraphs also carry the attr).
    if (id && !map.has(id)) map.set(id, el);
  }
  return map;
}

describe("render node reuse across an edit (incremental render)", () => {
  it("a single-block edit reuses every OTHER block's node (N − 1 reused)", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: longDoc() });
    document.body.appendChild((ed as unknown as { host: HTMLElement }).host);

    const before = blockEls(ed);
    expect(before.size).toBe(N);

    // Edit ONE block through the API (the path that re-renders): insert a run
    // into block 12.
    const target = ed.getBlock(12);
    const at: InlinePosition = {
      block: { id: target.id, version: target.version },
      offset: 0,
    };
    const ctx = (ed as unknown as { ctx: EditorContext }).ctx;
    const res = runs.insertRun(ctx, at, { kind: "text", text: "X", properties: {} });
    expect(res.ok).toBe(true);

    const after = blockEls(ed);
    let reused = 0;
    for (const [id, el] of before) if (after.get(id) === el) reused += 1;

    // Only the edited block (#12) is re-rendered; the other 24 keep their node.
    expect(reused).toBe(N - 1);

    // The edited block's text did change (sanity: the edit landed).
    expect(ed.getBlock(12).text.startsWith("X")).toBe(true);
    ed.destroy();
  });
});

/**
 * The correctness guard: an incremental render must produce DOM
 * BYTE-IDENTICAL to a full render of the same resulting document. We drive a
 * real edit (incremental), then full-render the editor's current doc with the
 * SAME block ids into a scratch host, and compare innerHTML. Runs across a
 * spread of edit shapes — content edits (reuse path) and structural edits
 * (full-render fallback) — so a wrong reuse (stale context) shows up here.
 */
describe("incremental render === full render (byte-identical)", () => {
  function mixedDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [
      heading(1, [text("Title")]),
      paragraph([text("Intro paragraph.")]),
      paragraph([text("Body one, "), text("bold bit", { bold: true }), text(", tail.")]),
      heading(2, [text("Section")]),
      paragraph([text("Body two.")], { alignment: "center" }),
      paragraph([text("Body three.")]),
    ];
    return d;
  }

  function fullRenderHtml(ed: Editor): string {
    const doc = ed.getDocument();
    const ids = doc.body.map((_, i) => ed.getBlock(i).id);
    const scratch = document.createElement("div");
    renderSobreeDocument(doc, scratch, ids);
    return scratch.innerHTML;
  }

  function withEditor(run: (ed: Editor, ctx: EditorContext) => void): void {
    const ed = new Editor(document.createElement("div"), { initialDocument: mixedDoc() });
    document.body.appendChild((ed as unknown as { host: HTMLElement }).host);
    const ctx = (ed as unknown as { ctx: EditorContext }).ctx;
    run(ed, ctx);
    const host = (ed as unknown as { host: HTMLElement }).host;
    expect(host.innerHTML).toBe(fullRenderHtml(ed));
    ed.destroy();
  }

  const ref = (ed: Editor, i: number) => {
    const b = ed.getBlock(i);
    return { id: b.id, version: b.version };
  };

  it("matches after inserting text mid-paragraph (reuse path)", () => {
    withEditor((ed, ctx) => {
      runs.insertRun(
        ctx,
        { block: ref(ed, 2), offset: 4 },
        { kind: "text", text: "ZZ", properties: {} },
      );
    });
  });

  it("matches after deleting a range (reuse path)", () => {
    withEditor((ed, ctx) => {
      runs.deleteRange(ctx, {
        from: { block: ref(ed, 1), offset: 0 },
        to: { block: ref(ed, 1), offset: 5 },
      });
    });
  });

  it("matches after applying a run property / bold (reuse path)", () => {
    withEditor((ed, ctx) => {
      runs.applyRunProperties(
        ctx,
        { from: { block: ref(ed, 4), offset: 0 }, to: { block: ref(ed, 4), offset: 4 } },
        { bold: true },
      );
    });
  });

  it("matches after splitting a paragraph (structural → full-render fallback)", () => {
    withEditor((ed, ctx) => {
      runs.splitBlock(ctx, { block: ref(ed, 5), offset: 4 });
    });
  });

  it("matches after a paragraph-boundary merge (structural)", () => {
    withEditor((ed, ctx) => {
      runs.deleteRange(ctx, {
        from: { block: ref(ed, 4), offset: ed.getBlock(4).text.length },
        to: { block: ref(ed, 5), offset: 0 },
      });
    });
  });
});
