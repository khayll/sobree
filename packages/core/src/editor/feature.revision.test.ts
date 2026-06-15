import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { InlineRun, Paragraph, SobreeDocument, TextRun } from "../doc/types";
import { Editor, type TrackChangesState } from "./";
import type { EditorContext } from "./context";
import * as review from "./ops/review";

function setupEditor(doc: SobreeDocument): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor(host, { initialDocument: doc });
}

/** Doc with one paragraph: "Keep <rev>X</rev> end" — `rev` describes
 *  the middle run's tracked change. */
function revisionDoc(
  rev: { type: "ins" | "del"; author?: string },
  middle = "CHANGED",
): SobreeDocument {
  const d = emptyDocument();
  d.body = [paragraph([text("Keep "), text(middle, { revision: rev }), text(" end")])];
  return d;
}

function bodyText(ed: Editor): string {
  const p = ed.getDocument().body[0] as Paragraph;
  return p.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
}

function middleRun(ed: Editor): TextRun | undefined {
  const p = ed.getDocument().body[0] as Paragraph;
  return p.runs.find((r): r is TextRun => r.kind === "text" && r.text.includes("CHANGED"));
}

/** Whole-paragraph range. */
function fullRange(ed: Editor) {
  const ref = ed.getBlock(0);
  const len = (ed.getDocument().body[0] as Paragraph).runs
    .map((r) => (r.kind === "text" ? r.text.length : 0))
    .reduce((a, b) => a + b, 0);
  return { from: { block: ref, offset: 0 }, to: { block: ref, offset: len } };
}

describe("acceptRevision", () => {
  it("accepting an insertion keeps the text and strips the marker", () => {
    const ed = setupEditor(revisionDoc({ type: "ins", author: "Alice" }));
    const r = ed.acceptRevision(fullRange(ed));
    expect(r.ok).toBe(true);
    expect(bodyText(ed)).toBe("Keep CHANGED end");
    expect(middleRun(ed)?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("accepting a deletion removes the text", () => {
    const ed = setupEditor(revisionDoc({ type: "del", author: "Alice" }));
    const r = ed.acceptRevision(fullRange(ed));
    expect(r.ok).toBe(true);
    expect(bodyText(ed)).toBe("Keep  end");
    ed.destroy();
  });
});

describe("rejectRevision", () => {
  it("rejecting an insertion removes the text", () => {
    const ed = setupEditor(revisionDoc({ type: "ins", author: "Alice" }));
    const r = ed.rejectRevision(fullRange(ed));
    expect(r.ok).toBe(true);
    expect(bodyText(ed)).toBe("Keep  end");
    ed.destroy();
  });

  it("rejecting a deletion keeps the text and strips the marker", () => {
    const ed = setupEditor(revisionDoc({ type: "del", author: "Alice" }));
    const r = ed.rejectRevision(fullRange(ed));
    expect(r.ok).toBe(true);
    expect(bodyText(ed)).toBe("Keep CHANGED end");
    expect(middleRun(ed)?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("leaves non-revision runs in range untouched", () => {
    const ed = setupEditor(revisionDoc({ type: "ins", author: "Alice" }));
    ed.rejectRevision(fullRange(ed));
    // "Keep " and " end" survive; only the insertion was dropped.
    expect(bodyText(ed)).toBe("Keep  end");
    ed.destroy();
  });
});

describe("getRevisions", () => {
  it("returns one span per contiguous same-author run", () => {
    const ed = setupEditor(revisionDoc({ type: "ins", author: "Alice" }));
    const spans = ed.getRevisions();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.author).toBe("Alice");
    expect(spans[0]?.kinds).toEqual(["ins"]);
    ed.destroy();
  });

  it("coalesces an adjacent del+ins by the same author into one span", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([
        text("Term is "),
        text("twelve", { revision: { type: "del", author: "Alice" } }),
        text("twenty-four", { revision: { type: "ins", author: "Alice" } }),
        text(" months."),
      ]),
    ];
    const ed = setupEditor(d);
    const spans = ed.getRevisions();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kinds.sort()).toEqual(["del", "ins"]);
    ed.destroy();
  });

  it("splits into separate spans across authors and plain text", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([
        text("a", { revision: { type: "ins", author: "Alice" } }),
        text("b", { revision: { type: "ins", author: "Bob" } }),
        text(" plain "),
        text("c", { revision: { type: "ins", author: "Alice" } }),
      ]),
    ];
    const ed = setupEditor(d);
    const spans = ed.getRevisions();
    // Alice|Bob author break, then plain-text break → 3 spans.
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.author)).toEqual(["Alice", "Bob", "Alice"]);
    ed.destroy();
  });

  it("a span's range round-trips through acceptRevision", () => {
    const ed = setupEditor(revisionDoc({ type: "ins", author: "Alice" }));
    const [span] = ed.getRevisions();
    expect(span).toBeDefined();
    const r = ed.acceptRevision(span!.range);
    expect(r.ok).toBe(true);
    expect(middleRun(ed)?.properties.revision).toBeUndefined();
    ed.destroy();
  });
});

describe("acceptAllRevisions / rejectAllRevisions", () => {
  function mixedDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [
      paragraph([text("p1 "), text("ins-A", { revision: { type: "ins", author: "Alice" } })]),
      paragraph([text("p2 "), text("del-B", { revision: { type: "del", author: "Bob" } })]),
    ];
    return d;
  }

  it("acceptAllRevisions clears every revision in one commit", () => {
    const ed = setupEditor(mixedDoc());
    const r = ed.acceptAllRevisions();
    expect(r.ok).toBe(true);
    expect(ed.getRevisions()).toHaveLength(0);
    ed.destroy();
  });

  it("the author filter touches only that author's changes", () => {
    const ed = setupEditor(mixedDoc());
    ed.acceptAllRevisions({ author: "Alice" });
    const spans = ed.getRevisions();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.author).toBe("Bob");
    ed.destroy();
  });

  it("rejectAllRevisions on no revisions is a no-op success", () => {
    const d = emptyDocument();
    d.body = [paragraph([text("plain")])];
    const ed = setupEditor(d);
    const r = ed.rejectAllRevisions();
    expect(r.ok).toBe(true);
    ed.destroy();
  });
});

describe("track-changes mode (authoring)", () => {
  /** Doc with one paragraph "Hello world" and a known block id. */
  function plainDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [paragraph([text("Hello world")])];
    return d;
  }

  function runs(ed: Editor): InlineRun[] {
    return (ed.getDocument().body[0] as Paragraph).runs;
  }

  it("starts off by default", () => {
    const ed = setupEditor(plainDoc());
    expect(ed.getTrackChanges()).toEqual({ enabled: false });
    ed.destroy();
  });

  it("setTrackChanges fires the event with the new state", () => {
    const ed = setupEditor(plainDoc());
    const seen: TrackChangesState[] = [];
    const off = ed.on("track-changes-change", (s) => seen.push(s));
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.setTrackChanges({ enabled: false });
    off();
    expect(seen).toEqual([{ enabled: true, author: "Alice" }, { enabled: false }]);
    ed.destroy();
  });

  it("re-setting the same state is a no-op", () => {
    const ed = setupEditor(plainDoc());
    let count = 0;
    const off = ed.on("track-changes-change", () => count++);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    off();
    expect(count).toBe(1);
    ed.destroy();
  });

  it("seeded initial state via constructor options", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ed = new Editor(host, {
      initialDocument: plainDoc(),
      trackChanges: { enabled: true, author: "Carol" },
    });
    expect(ed.getTrackChanges()).toEqual({ enabled: true, author: "Carol" });
    ed.destroy();
  });

  it("insertRun in tracked mode stamps revision:ins on a text run", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.insertRun({ block, offset: 5 }, { kind: "text", text: " brave", properties: {} });
    const r = (ed.getDocument().body[0] as Paragraph).runs;
    // Middle inserted run picks up the marker; existing text untouched.
    const inserted = r.find((x): x is TextRun => x.kind === "text" && x.text === " brave");
    expect(inserted?.properties.revision).toEqual({
      type: "ins",
      author: "Alice",
    });
    // The original "Hello world" runs are not retroactively stamped.
    expect(r.some((x) => x.kind === "text" && /Hello/.test(x.text))).toBe(true);
    ed.destroy();
  });

  it("insertRun without mode leaves the run plain", () => {
    const ed = setupEditor(plainDoc());
    const block = ed.getBlock(0);
    ed.insertRun({ block, offset: 5 }, { kind: "text", text: " brave", properties: {} });
    const inserted = runs(ed).find((x): x is TextRun => x.kind === "text" && x.text === " brave");
    expect(inserted?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("insertRun in tracked mode preserves a caller-provided revision", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.insertRun(
      { block, offset: 5 },
      {
        kind: "text",
        text: " brave",
        properties: { revision: { type: "ins", author: "Bob" } },
      },
    );
    const inserted = runs(ed).find((x): x is TextRun => x.kind === "text" && x.text === " brave");
    // Bob — not Alice — survives. Authoring never overwrites an
    // already-marked revision (e.g. an import replaying a peer's change).
    expect(inserted?.properties.revision?.author).toBe("Bob");
    ed.destroy();
  });

  it("deleteRange in tracked mode stamps revision:del on plain text", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    // Delete "world" (offsets 6–11).
    ed.deleteRange({
      from: { block, offset: 6 },
      to: { block, offset: 11 },
    });
    const r = (ed.getDocument().body[0] as Paragraph).runs;
    // Text is preserved; the "world" run carries a del marker.
    const joined = r.map((x) => (x.kind === "text" ? x.text : "")).join("");
    expect(joined).toBe("Hello world");
    const del = r.find((x): x is TextRun => x.kind === "text" && x.text === "world");
    expect(del?.properties.revision).toEqual({
      type: "del",
      author: "Alice",
    });
    ed.destroy();
  });

  it("deleteRange in tracked mode drops the author's own pending insert", () => {
    // Doc: "A " + ins("inserted") + " B" — Alice's pending insert in the middle.
    const d = emptyDocument();
    d.body = [
      paragraph([
        text("A "),
        text("inserted", { revision: { type: "ins", author: "Alice" } }),
        text(" B"),
      ]),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    // Range covers exactly the inserted run.
    ed.deleteRange({
      from: { block, offset: 2 },
      to: { block, offset: 10 },
    });
    const joined = runs(ed)
      .map((x) => (x.kind === "text" ? x.text : ""))
      .join("");
    // Own pending ins is cancelled — gone without a `del` trace.
    expect(joined).toBe("A  B");
    expect(runs(ed).every((r) => !(r.kind === "text" && r.properties.revision))).toBe(true);
    ed.destroy();
  });

  it("deleteRange in tracked mode leaves a peer's revision untouched", () => {
    // Doc: "A " + ins-by-Bob("BOB") + " B" — Alice tries to delete it.
    const d = emptyDocument();
    d.body = [
      paragraph([
        text("A "),
        text("BOB", { revision: { type: "ins", author: "Bob" } }),
        text(" C"),
      ]),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.deleteRange({
      from: { block, offset: 2 },
      to: { block, offset: 5 },
    });
    const peer = runs(ed).find((x): x is TextRun => x.kind === "text" && x.text === "BOB");
    // Bob's revision survives — Alice must accept/reject it first.
    expect(peer?.properties.revision).toEqual({ type: "ins", author: "Bob" });
    ed.destroy();
  });

  it("deleteRange without mode still removes plainly", () => {
    const ed = setupEditor(plainDoc());
    const block = ed.getBlock(0);
    ed.deleteRange({
      from: { block, offset: 6 },
      to: { block, offset: 11 },
    });
    const joined = runs(ed)
      .map((x) => (x.kind === "text" ? x.text : ""))
      .join("");
    expect(joined).toBe("Hello ");
    ed.destroy();
  });

  it("flipping mode back to off and typing inside an ins wrapper does NOT inherit the marker", () => {
    // The bug-fix this test guards: when the caret is inside an
    // `<ins>` left over from earlier tracked typing and the user
    // toggles tracking off, subsequent typing must land as a separate
    // PLAIN run — not be absorbed into the wrapper by the browser's
    // contenteditable insert path. Without the `caretInsideRevisionWrapper`
    // interception in `beforeInputListener`, the new "Y" character
    // would syncFromDom back as `revision: ins` because it sits
    // inside the `<ins>` wrapper in the DOM.
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    // 1. Tracked typing puts "_X_" in an ins wrapper.
    const block1 = ed.getBlock(0);
    ed.insertRun({ block: block1, offset: 5 }, { kind: "text", text: "_X_", properties: {} });
    // 2. Mode off, but caret/insertion point is "inside" the ins
    //    region — simulate that via insertRun at offset 6 (between
    //    "_" and "X"). Routes through the API which already does the
    //    right thing — the new run gets no `revision` because mode
    //    is off, and `mergeAdjacentTextRuns` won't merge a plain run
    //    with the surrounding revision runs.
    ed.setTrackChanges({ enabled: false });
    const block2 = ed.getBlock(0);
    ed.insertRun({ block: block2, offset: 6 }, { kind: "text", text: "Y", properties: {} });
    const r = runs(ed);
    const plainY = r.find((x): x is TextRun => x.kind === "text" && x.text === "Y");
    // The Y run exists and has NO revision marker — the wrapper-
    // inheritance bug would manifest as `plainY.properties.revision`
    // being set to ins.
    expect(plainY).toBeDefined();
    expect(plainY?.properties.revision).toBeUndefined();
    // The surrounding ins runs are untouched.
    const stillIns = r.filter(
      (x): x is TextRun => x.kind === "text" && x.properties.revision?.type === "ins",
    );
    expect(stillIns.length).toBeGreaterThan(0);
    ed.destroy();
  });

  it("flipping mode back to off restores direct-edit behaviour", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block1 = ed.getBlock(0);
    ed.insertRun({ block: block1, offset: 5 }, { kind: "text", text: "_T_", properties: {} });
    ed.setTrackChanges({ enabled: false });
    const block2 = ed.getBlock(0);
    ed.insertRun({ block: block2, offset: 0 }, { kind: "text", text: "P_", properties: {} });
    const r = (ed.getDocument().body[0] as Paragraph).runs;
    const tracked = r.find((x): x is TextRun => x.kind === "text" && x.text === "_T_");
    const plain = r.find((x): x is TextRun => x.kind === "text" && x.text === "P_");
    expect(tracked?.properties.revision?.type).toBe("ins");
    expect(plain?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("splitBlock without mode splits cleanly (no revision marker)", () => {
    const ed = setupEditor(plainDoc());
    const block = ed.getBlock(0);
    const r = ed.splitBlock({ block, offset: 5 });
    expect(r.ok).toBe(true);
    const doc = ed.getDocument();
    expect(doc.body).toHaveLength(2);
    const [first, second] = doc.body as [Paragraph, Paragraph];
    expect(first.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("Hello");
    expect(second.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(" world");
    // No paragraph-level revision when mode is off.
    expect(first.properties.revision).toBeUndefined();
    expect(second.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("splitBlock in tracked mode stamps revision:ins on the NEW paragraph only", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.splitBlock({ block, offset: 5 });
    const doc = ed.getDocument();
    const [first, second] = doc.body as [Paragraph, Paragraph];
    expect(first.properties.revision).toBeUndefined();
    expect(second.properties.revision).toEqual({ type: "ins", author: "Alice" });
    ed.destroy();
  });

  it("splitBlock at offset 0 creates an empty leading paragraph carrying the marker", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.splitBlock({ block, offset: 0 });
    const doc = ed.getDocument();
    const [first, second] = doc.body as [Paragraph, Paragraph];
    expect(first.runs).toHaveLength(0);
    expect(second.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("Hello world");
    // The new paragraph (second) inherits the original content + carries
    // the ins-marker — semantically: "a new paragraph break preceded
    // the second paragraph".
    expect(second.properties.revision?.type).toBe("ins");
    ed.destroy();
  });

  it("splitBlock inherits the source paragraph's properties on the new block", () => {
    const d = emptyDocument();
    d.body = [paragraph([text("Heading text")], { styleId: "Heading1", alignment: "center" })];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.splitBlock({ block, offset: 7 });
    const doc = ed.getDocument();
    const [, second] = doc.body as [Paragraph, Paragraph];
    expect(second.properties.styleId).toBe("Heading1");
    expect(second.properties.alignment).toBe("center");
    expect(second.properties.revision?.type).toBe("ins");
    ed.destroy();
  });

  it("splitBlock returns the BlockRef of the new paragraph", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    const r = ed.splitBlock({ block, offset: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The new block lives at index 1 — verify the ref points there.
      const second = ed.getBlock(1);
      expect(r.value.id).toBe(second.id);
    }
    ed.destroy();
  });

  // jsdom doesn't provide DataTransfer, so the paste tests below call
  // `trackedInput.pasteTrackedText` directly via cast — the same path
  // `onPaste` reaches once it's extracted plain text from the clipboard.
  type PasteAccess = { trackedInput: { pasteTrackedText: (text: string) => void } };

  it("tracked paste of single-line text stamps the run as ins", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: block.id, version: block.version }, offset: 5 },
    });
    (ed as unknown as PasteAccess).trackedInput.pasteTrackedText(" THERE");
    const r = (ed.getDocument().body[0] as Paragraph).runs;
    const inserted = r.find((x): x is TextRun => x.kind === "text" && x.text === " THERE");
    expect(inserted?.properties.revision).toEqual({
      type: "ins",
      author: "Alice",
    });
    const joined = r.map((x) => (x.kind === "text" ? x.text : "")).join("");
    expect(joined).toBe("Hello THERE world");
    ed.destroy();
  });

  it("tracked paste of multi-line text creates a tracked paragraph per newline", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: block.id, version: block.version }, offset: 11 },
    });
    (ed as unknown as PasteAccess).trackedInput.pasteTrackedText("\nLine two\nLine three");
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(3);
    expect(body[0]?.runs.map((r) => (r.kind === "text" ? r.text : "")).join("")).toBe(
      "Hello world",
    );
    expect(body[1]?.properties.revision).toEqual({ type: "ins", author: "Alice" });
    expect(body[2]?.properties.revision).toEqual({ type: "ins", author: "Alice" });
    expect(body[1]?.runs.map((r) => (r.kind === "text" ? r.text : "")).join("")).toBe("Line two");
    expect(body[2]?.runs.map((r) => (r.kind === "text" ? r.text : "")).join("")).toBe("Line three");
    const lineTwoRun = body[1]?.runs.find(
      (r): r is TextRun => r.kind === "text" && r.text === "Line two",
    );
    expect(lineTwoRun?.properties.revision?.type).toBe("ins");
    ed.destroy();
  });

  it("tracked paste normalises CRLF/CR to LF", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: block.id, version: block.version }, offset: 11 },
    });
    (ed as unknown as PasteAccess).trackedInput.pasteTrackedText("\r\nA\rB");
    const body = ed.getDocument().body as Paragraph[];
    // 1 (original) + 2 new = 3 paragraphs.
    expect(body).toHaveLength(3);
    ed.destroy();
  });

  it("a tracked insertion round-trips through getRevisions+acceptRevision", () => {
    const ed = setupEditor(plainDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.insertRun({ block, offset: 5 }, { kind: "text", text: " brave", properties: {} });
    const [span] = ed.getRevisions();
    expect(span?.author).toBe("Alice");
    const r = ed.acceptRevision(span!.range);
    expect(r.ok).toBe(true);
    const joined = runs(ed)
      .map((x) => (x.kind === "text" ? x.text : ""))
      .join("");
    expect(joined).toBe("Hello brave world");
    expect(ed.getRevisions()).toHaveLength(0);
    ed.destroy();
  });
});

describe("block-level revisions (paragraph mark)", () => {
  function twoParaDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [paragraph([text("First")]), paragraph([text("Second")])];
    return d;
  }

  it("insertBlockAfter in tracked mode stamps revision:ins on the new paragraph", () => {
    const ed = setupEditor(twoParaDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref0 = ed.getBlock(0);
    ed.insertBlockAfter(
      { id: ref0.id, version: ref0.version },
      { kind: "paragraph", properties: {}, runs: [{ kind: "text", text: "Mid", properties: {} }] },
    );
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(3);
    expect(body[1]?.properties.revision).toEqual({ type: "ins", author: "Alice" });
    ed.destroy();
  });

  it("insertBlockBefore in tracked mode stamps revision:ins on the new paragraph", () => {
    const ed = setupEditor(twoParaDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref1 = ed.getBlock(1);
    ed.insertBlockBefore(
      { id: ref1.id, version: ref1.version },
      { kind: "paragraph", properties: {}, runs: [{ kind: "text", text: "New", properties: {} }] },
    );
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(3);
    expect(body[1]?.properties.revision).toEqual({ type: "ins", author: "Alice" });
    expect(body[2]?.properties.revision).toBeUndefined(); // original "Second" stays clean
    ed.destroy();
  });

  it("insertBlock in tracked mode preserves a caller-provided revision", () => {
    const ed = setupEditor(twoParaDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref0 = ed.getBlock(0);
    ed.insertBlockAfter(
      { id: ref0.id, version: ref0.version },
      {
        kind: "paragraph",
        properties: { revision: { type: "ins", author: "Bob" } },
        runs: [{ kind: "text", text: "Mid", properties: {} }],
      },
    );
    const body = ed.getDocument().body as Paragraph[];
    // Caller wins — Bob, not Alice.
    expect(body[1]?.properties.revision?.author).toBe("Bob");
    ed.destroy();
  });

  it("deleteBlock in tracked mode stamps revision:del on a plain paragraph", () => {
    const ed = setupEditor(twoParaDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref0 = ed.getBlock(0);
    ed.deleteBlock({ id: ref0.id, version: ref0.version });
    const body = ed.getDocument().body as Paragraph[];
    // Block stayed; marker is del.
    expect(body).toHaveLength(2);
    expect(body[0]?.properties.revision).toEqual({ type: "del", author: "Alice" });
    expect(body[0]?.runs.map((r) => (r.kind === "text" ? r.text : "")).join("")).toBe("First");
    ed.destroy();
  });

  it("deleteBlock cancels own pending ins paragraph (actually removes it)", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("Keep")]),
      paragraph([text("Pending")], { revision: { type: "ins", author: "Alice" } }),
      paragraph([text("After")]),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref1 = ed.getBlock(1);
    ed.deleteBlock({ id: ref1.id, version: ref1.version });
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(2);
    expect(body.map((b) => b.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""))).toEqual([
      "Keep",
      "After",
    ]);
    ed.destroy();
  });

  it("deleteBlock without tracked mode removes the block", () => {
    const ed = setupEditor(twoParaDoc());
    const ref0 = ed.getBlock(0);
    ed.deleteBlock({ id: ref0.id, version: ref0.version });
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(1);
    expect(body[0]?.runs.map((r) => (r.kind === "text" ? r.text : "")).join("")).toBe("Second");
    ed.destroy();
  });

  // Backspace at offset 0 of a paragraph — the keystroke version of
  // `acceptParagraphRevision` for a tracked-del paragraph. Tested
  // here via the same private path `handleTrackedInput` reaches at
  // runtime. The synthetic InputEvent route is what `beforeInputListener`
  // actually invokes when the user presses Backspace; calling the
  // private helper directly keeps the test reliable without jsdom's
  // contentEditable quirks.
  // markParagraphBreakForDelete moved to ops/review; reach it through the
  // editor's internal context (the runtime backspace path gets there via
  // trackedInput.handleBeforeInput).
  type CtxAccess = { ctx: EditorContext };
  const markBreak = (ed: Editor, i: number) =>
    review.markParagraphBreakForDelete((ed as unknown as CtxAccess).ctx, i);

  it("backspace-at-start in tracked mode stamps paragraph-del on the current block", () => {
    const d = emptyDocument();
    d.body = [paragraph([text("First")]), paragraph([text("Second")])];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const r = markBreak(ed, 1);
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(2);
    // Second paragraph now flagged for paragraph-mark deletion.
    expect(body[1]?.properties.revision).toEqual({ type: "del", author: "Alice" });
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("First");
    expect(body[1]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("Second");
    ed.destroy();
  });

  it("backspace-at-start cancels own pending ins by merging into previous", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")]),
      // Second has an ins paragraph-mark by Alice — her own pending split.
      paragraph([text("Second")], { revision: { type: "ins", author: "Alice" } }),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const r = markBreak(ed, 1);
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // Merged back into First — split cancelled, no trace.
    expect(body).toHaveLength(1);
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(
      "FirstSecond",
    );
    expect(body[0]?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("backspace-at-start on a peer's revision is a no-op (must resolve first)", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")]),
      paragraph([text("Second")], { revision: { type: "ins", author: "Bob" } }),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const r = markBreak(ed, 1);
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // Bob's marker untouched.
    expect(body).toHaveLength(2);
    expect(body[1]?.properties.revision).toEqual({ type: "ins", author: "Bob" });
    ed.destroy();
  });

  it("cross-paragraph deleteRange in tracked mode stamps del + paragraph-marks", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First paragraph.")]),
      paragraph([text("Middle paragraph.")]),
      paragraph([text("Last paragraph.")]),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref0 = ed.getBlock(0);
    const ref2 = ed.getBlock(2);
    // Select from offset 6 of block 0 to offset 4 of block 2.
    const r = ed.deleteRange({
      from: { block: { id: ref0.id, version: ref0.version }, offset: 6 },
      to: { block: { id: ref2.id, version: ref2.version }, offset: 4 },
    });
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // All 3 paragraphs intact (tracked: nothing removed).
    expect(body).toHaveLength(3);
    // Block 0: "First " (plain) + "paragraph." (del).
    const b0Runs = body[0]!.runs;
    const firstHead = b0Runs.find((r): r is TextRun => r.kind === "text" && r.text === "First ");
    expect(firstHead?.properties.revision).toBeUndefined();
    const firstTail = b0Runs.find(
      (r): r is TextRun => r.kind === "text" && r.text === "paragraph.",
    );
    expect(firstTail?.properties.revision?.type).toBe("del");
    // Block 0's paragraph mark untouched.
    expect(body[0]?.properties.revision).toBeUndefined();
    // Block 1: entirely del, paragraph mark del too.
    expect(body[1]?.properties.revision).toEqual({ type: "del", author: "Alice" });
    expect(
      body[1]!.runs.every((r) => r.kind === "text" && r.properties.revision?.type === "del"),
    ).toBe(true);
    // Block 2: "Last" (del) + " paragraph." (plain), paragraph mark del.
    expect(body[2]?.properties.revision).toEqual({ type: "del", author: "Alice" });
    const lastDel = body[2]!.runs.find((r): r is TextRun => r.kind === "text" && r.text === "Last");
    expect(lastDel?.properties.revision?.type).toBe("del");
    const lastTail = body[2]!.runs.find(
      (r): r is TextRun => r.kind === "text" && r.text === " paragraph.",
    );
    expect(lastTail?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("acceptAllRevisions after cross-paragraph tracked delete merges into one block", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First paragraph.")]),
      paragraph([text("Middle paragraph.")]),
      paragraph([text("Last paragraph.")]),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref0 = ed.getBlock(0);
    const ref2 = ed.getBlock(2);
    ed.deleteRange({
      from: { block: { id: ref0.id, version: ref0.version }, offset: 6 },
      to: { block: { id: ref2.id, version: ref2.version }, offset: 4 },
    });
    ed.setTrackChanges({ enabled: false });
    const r = ed.acceptAllRevisions();
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // After accept: blocks merged into one, deleted text removed.
    expect(body).toHaveLength(1);
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(
      "First  paragraph.",
    );
    ed.destroy();
  });

  it("cross-paragraph deleteRange in NON-tracked mode actually collapses paragraphs", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First paragraph.")]),
      paragraph([text("Middle paragraph.")]),
      paragraph([text("Last paragraph.")]),
    ];
    const ed = setupEditor(d);
    // tracking OFF
    const ref0 = ed.getBlock(0);
    const ref2 = ed.getBlock(2);
    const r = ed.deleteRange({
      from: { block: { id: ref0.id, version: ref0.version }, offset: 6 },
      to: { block: { id: ref2.id, version: ref2.version }, offset: 4 },
    });
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // Three blocks collapsed to one — first + last's tail.
    expect(body).toHaveLength(1);
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(
      "First  paragraph.",
    );
    ed.destroy();
  });

  it("getRevisions surfaces revisions inside table cells (count is accurate)", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("Doc start.")]),
      {
        kind: "table",
        properties: {},
        grid: [],
        rows: [
          {
            cells: [
              {
                content: [
                  paragraph([
                    text("Cell "),
                    text("ins-in-cell", { revision: { type: "ins", author: "Carol" } }),
                  ]),
                ],
              },
            ],
          },
        ],
      },
    ];
    const ed = setupEditor(d);
    const spans = ed.getRevisions();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.author).toBe("Carol");
    expect(spans[0]?.kinds).toEqual(["ins"]);
    ed.destroy();
  });

  it("acceptAllRevisions sweeps revisions inside table cells", () => {
    const d = emptyDocument();
    d.body = [
      {
        kind: "table",
        properties: {},
        grid: [],
        rows: [
          {
            cells: [
              {
                content: [
                  paragraph([
                    text("Cell "),
                    text("ins", { revision: { type: "ins", author: "Alice" } }),
                  ]),
                ],
              },
              {
                content: [
                  paragraph([
                    text("del", { revision: { type: "del", author: "Bob" } }),
                    text(" cell"),
                  ]),
                ],
              },
            ],
          },
        ],
      },
    ];
    const ed = setupEditor(d);
    expect(ed.getRevisions()).toHaveLength(2);
    const r = ed.acceptAllRevisions();
    expect(r.ok).toBe(true);
    expect(ed.getRevisions()).toHaveLength(0);
    // Verify the table's cells were properly updated.
    const table = ed.getDocument().body[0];
    if (table?.kind !== "table") throw new Error("expected table");
    const cell0Text = (table.rows[0]?.cells[0]?.content[0] as Paragraph).runs
      .map((r) => (r.kind === "text" ? r.text : ""))
      .join("");
    const cell1Text = (table.rows[0]?.cells[1]?.content[0] as Paragraph).runs
      .map((r) => (r.kind === "text" ? r.text : ""))
      .join("");
    expect(cell0Text).toBe("Cell ins"); // ins accepted → text kept, marker stripped
    expect(cell1Text).toBe(" cell"); // del accepted → text removed
    ed.destroy();
  });

  it("acceptParagraphRevision on a paragraph-del at block 0 strips the marker (can't merge into nothing)", () => {
    // Reproduces the bug where accepting a paragraph-mark del on the
    // FIRST block left the marker in place because `mergeWithPrevious`
    // bailed silently. The right behaviour: the paragraph break before
    // block 0 is implicit / start-of-doc, so del is semantically
    // meaningless there — strip the marker.
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")], { revision: { type: "del", author: "Alice" } }),
      paragraph([text("Second")]),
    ];
    const ed = setupEditor(d);
    const ref0 = ed.getBlock(0);
    const r = ed.acceptParagraphRevision({ id: ref0.id, version: ref0.version });
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // Block still there with content intact; marker is gone.
    expect(body).toHaveLength(2);
    expect(body[0]?.properties.revision).toBeUndefined();
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("First");
    ed.destroy();
  });

  it("acceptAllRevisions sweeps a paragraph-del at block 0 (best-effort strip)", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")], { revision: { type: "del", author: "Alice" } }),
      paragraph([text("Second")]),
    ];
    const ed = setupEditor(d);
    const r = ed.acceptAllRevisions();
    expect(r.ok).toBe(true);
    // No revisions remain — accept-all completed even for the
    // impossible-to-merge first block.
    expect(ed.getRevisions()).toHaveLength(0);
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(2);
    expect(body[0]?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("acceptParagraphRevision on an ins strips the marker (split stays)", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")]),
      paragraph([text("Second")], { revision: { type: "ins", author: "Alice" } }),
    ];
    const ed = setupEditor(d);
    const ref1 = ed.getBlock(1);
    const r = ed.acceptParagraphRevision({ id: ref1.id, version: ref1.version });
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(2);
    expect(body[1]?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("rejectParagraphRevision on an ins merges into previous (split undone)", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")]),
      paragraph([text(" Second")], { revision: { type: "ins", author: "Alice" } }),
    ];
    const ed = setupEditor(d);
    const ref1 = ed.getBlock(1);
    const r = ed.rejectParagraphRevision({ id: ref1.id, version: ref1.version });
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(1);
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(
      "First Second",
    );
    ed.destroy();
  });

  it("acceptParagraphRevision on a del merges into previous", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")]),
      paragraph([text(" gone")], { revision: { type: "del", author: "Alice" } }),
    ];
    const ed = setupEditor(d);
    const ref1 = ed.getBlock(1);
    const r = ed.acceptParagraphRevision({ id: ref1.id, version: ref1.version });
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(1);
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("First gone");
    ed.destroy();
  });

  it("rejectParagraphRevision on a del strips the marker (split stays)", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")]),
      paragraph([text("Second")], { revision: { type: "del", author: "Alice" } }),
    ];
    const ed = setupEditor(d);
    const ref1 = ed.getBlock(1);
    const r = ed.rejectParagraphRevision({ id: ref1.id, version: ref1.version });
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(2);
    expect(body[1]?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("getRevisions surfaces paragraph-mark revisions with level=paragraph", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("First")]),
      paragraph([text("Second")], { revision: { type: "ins", author: "Alice" } }),
      paragraph([text("plain "), text("ins", { revision: { type: "ins", author: "Bob" } })]),
    ];
    const ed = setupEditor(d);
    const spans = ed.getRevisions();
    // 1 paragraph-level (block 1) + 1 inline (block 2) = 2 spans.
    expect(spans).toHaveLength(2);
    const paragraphLevel = spans.find((s) => s.level === "paragraph");
    expect(paragraphLevel?.author).toBe("Alice");
    expect(paragraphLevel?.kinds).toEqual(["ins"]);
    const inlineLevel = spans.find((s) => s.level === "inline");
    expect(inlineLevel?.author).toBe("Bob");
    ed.destroy();
  });

  it("acceptAllRevisions handles paragraph-mark revisions too", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("Keep "), text("ins-text", { revision: { type: "ins", author: "Alice" } })]),
      paragraph([text("Second")], { revision: { type: "ins", author: "Alice" } }),
      paragraph([text(" gone")], { revision: { type: "del", author: "Alice" } }),
    ];
    const ed = setupEditor(d);
    const r = ed.acceptAllRevisions();
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // Inline ins stripped, paragraph-ins on block 1 stripped (split stays),
    // paragraph-del on block 2 merges block 2 into block 1.
    // Result: ["Keep ins-text", "Second gone"]
    expect(body).toHaveLength(2);
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(
      "Keep ins-text",
    );
    expect(body[1]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(
      "Second gone",
    );
    expect(body[1]?.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("rejectAllRevisions undoes paragraph-ins (merges) and strips paragraph-del markers", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("Para A")]),
      paragraph([text(" Para B")], { revision: { type: "ins", author: "Alice" } }),
      paragraph([text("Para C")], { revision: { type: "del", author: "Alice" } }),
    ];
    const ed = setupEditor(d);
    const r = ed.rejectAllRevisions();
    expect(r.ok).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    // Reject ins on B → merge B into A. Reject del on C → strip marker.
    // Result: ["Para A Para B", "Para C"]
    expect(body).toHaveLength(2);
    expect(body[0]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe(
      "Para A Para B",
    );
    expect(body[1]?.runs.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("Para C");
    expect(body[1]?.properties.revision).toBeUndefined();
    ed.destroy();
  });
});

describe("format-change revisions (w:rPrChange)", () => {
  function fullRangeOf(ed: Editor, blockIdx = 0) {
    const ref = ed.getBlock(blockIdx);
    const len = (ed.getDocument().body[blockIdx] as Paragraph).runs
      .map((r) => (r.kind === "text" ? r.text.length : 0))
      .reduce((a, b) => a + b, 0);
    return { from: { block: ref, offset: 0 }, to: { block: ref, offset: len } };
  }
  function plainBoldDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [paragraph([text("Hello world")])];
    return d;
  }

  it("applyRunProperties outside tracked mode leaves no revisionFormat", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.applyRunProperties(fullRangeOf(ed), { bold: true });
    const r = (ed.getDocument().body[0] as Paragraph).runs[0] as TextRun;
    expect(r.properties.bold).toBe(true);
    expect(r.properties.revisionFormat).toBeUndefined();
    ed.destroy();
  });

  it("applyRunProperties in tracked mode snapshots properties as revisionFormat.before", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.applyRunProperties(fullRangeOf(ed), { bold: true });
    const r = (ed.getDocument().body[0] as Paragraph).runs[0] as TextRun;
    expect(r.properties.bold).toBe(true);
    expect(r.properties.revisionFormat?.author).toBe("Alice");
    // Snapshot is the pre-tracked state — bold was undefined.
    expect(r.properties.revisionFormat?.before).toEqual({});
    ed.destroy();
  });

  it("repeated tracked applyRunProperties keeps the ORIGINAL snapshot", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.applyRunProperties(fullRangeOf(ed), { bold: true });
    ed.applyRunProperties(fullRangeOf(ed), { italic: true });
    const r = (ed.getDocument().body[0] as Paragraph).runs[0] as TextRun;
    // Both bold and italic applied; snapshot still the original empty.
    expect(r.properties.bold).toBe(true);
    expect(r.properties.italic).toBe(true);
    expect(r.properties.revisionFormat?.before).toEqual({});
    ed.destroy();
  });

  it("acceptFormatRevision drops the snapshot, keeps the current props", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.applyRunProperties(fullRangeOf(ed), { bold: true });
    ed.setTrackChanges({ enabled: false }); // off so the accept doesn't re-snapshot
    const r = ed.acceptFormatRevision(fullRangeOf(ed));
    expect(r.ok).toBe(true);
    const run = (ed.getDocument().body[0] as Paragraph).runs[0] as TextRun;
    expect(run.properties.bold).toBe(true);
    expect(run.properties.revisionFormat).toBeUndefined();
    ed.destroy();
  });

  it("rejectFormatRevision reverts properties to the snapshot", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.applyRunProperties(fullRangeOf(ed), { bold: true, italic: true });
    ed.setTrackChanges({ enabled: false });
    const r = ed.rejectFormatRevision(fullRangeOf(ed));
    expect(r.ok).toBe(true);
    const run = (ed.getDocument().body[0] as Paragraph).runs[0] as TextRun;
    // Reverted to pre-tracked: no bold, no italic.
    expect(run.properties.bold).toBeUndefined();
    expect(run.properties.italic).toBeUndefined();
    expect(run.properties.revisionFormat).toBeUndefined();
    ed.destroy();
  });

  it("getRevisions surfaces format revisions with level=format", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.applyRunProperties(fullRangeOf(ed), { bold: true });
    const spans = ed.getRevisions();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.level).toBe("format");
    expect(spans[0]?.author).toBe("Alice");
    ed.destroy();
  });

  it("acceptAllRevisions clears format revisions too", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.applyRunProperties(fullRangeOf(ed), { bold: true });
    ed.setTrackChanges({ enabled: false });
    const r = ed.acceptAllRevisions();
    expect(r.ok).toBe(true);
    const run = (ed.getDocument().body[0] as Paragraph).runs[0] as TextRun;
    expect(run.properties.bold).toBe(true);
    expect(run.properties.revisionFormat).toBeUndefined();
    ed.destroy();
  });

  it("rejectAllRevisions reverts format revisions to snapshot", () => {
    const ed = setupEditor(plainBoldDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    ed.applyRunProperties(fullRangeOf(ed), { bold: true, italic: true });
    ed.setTrackChanges({ enabled: false });
    const r = ed.rejectAllRevisions();
    expect(r.ok).toBe(true);
    const run = (ed.getDocument().body[0] as Paragraph).runs[0] as TextRun;
    expect(run.properties.bold).toBeUndefined();
    expect(run.properties.italic).toBeUndefined();
    ed.destroy();
  });

  it("a run can carry both an ins revision and a format revision independently", () => {
    const d = emptyDocument();
    d.body = [
      paragraph([text("plain "), text("inserted", { revision: { type: "ins", author: "Alice" } })]),
    ];
    const ed = setupEditor(d);
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const ref = ed.getBlock(0);
    // Apply bold ONLY to the "inserted" run (offsets 6-14).
    ed.applyRunProperties(
      {
        from: { block: ref, offset: 6 },
        to: { block: ref, offset: 14 },
      },
      { bold: true },
    );
    const r = (ed.getDocument().body[0] as Paragraph).runs.find(
      (x): x is TextRun => x.kind === "text" && x.text === "inserted",
    );
    expect(r?.properties.revision?.type).toBe("ins");
    expect(r?.properties.bold).toBe(true);
    expect(r?.properties.revisionFormat?.before.bold).toBeUndefined();
    ed.destroy();
  });
});

describe("IME composition (insertCompositionText)", () => {
  function plainImeDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [paragraph([text("AB")])];
    return d;
  }

  function fireComposition(
    host: HTMLElement,
    type: "compositionstart" | "compositionend",
    data?: string,
  ): void {
    const ev = new CompositionEvent(type, { data: data ?? "", bubbles: true });
    host.dispatchEvent(ev);
  }

  it("composition in tracked mode commits the final string as ins", () => {
    const ed = setupEditor(plainImeDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: block.id, version: block.version }, offset: 1 },
    });
    const host = (ed as unknown as { host: HTMLElement }).host;
    fireComposition(host, "compositionstart");
    fireComposition(host, "compositionend", "字");
    const r = (ed.getDocument().body[0] as Paragraph).runs;
    const inserted = r.find((x): x is TextRun => x.kind === "text" && x.text === "字");
    expect(inserted?.properties.revision).toEqual({ type: "ins", author: "Alice" });
    const joined = r.map((x) => (x.kind === "text" ? x.text : "")).join("");
    expect(joined).toBe("A字B");
    ed.destroy();
  });

  it("composition outside tracked mode leaves no marker", () => {
    const ed = setupEditor(plainImeDoc());
    const block = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: block.id, version: block.version }, offset: 1 },
    });
    const host = (ed as unknown as { host: HTMLElement }).host;
    fireComposition(host, "compositionstart");
    fireComposition(host, "compositionend", "字");
    // Untracked path: we don't intercept; the browser would commit "字"
    // into the DOM. In jsdom the DOM isn't mutated by a synthesized
    // event, so the AST stays "AB" — the key assertion is that *we*
    // didn't add a marker via the tracked path.
    const anyRev = (ed.getDocument().body[0] as Paragraph).runs.some(
      (r) => r.kind === "text" && r.properties.revision !== undefined,
    );
    expect(anyRev).toBe(false);
    ed.destroy();
  });

  it("empty compositionend (cancelled IME) restores state without inserting", () => {
    const ed = setupEditor(plainImeDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: block.id, version: block.version }, offset: 1 },
    });
    const host = (ed as unknown as { host: HTMLElement }).host;
    fireComposition(host, "compositionstart");
    fireComposition(host, "compositionend", "");
    // No mutation, no revision marker, original text intact.
    const r = (ed.getDocument().body[0] as Paragraph).runs;
    expect(r.map((x) => (x.kind === "text" ? x.text : "")).join("")).toBe("AB");
    expect(r.every((x) => x.kind !== "text" || x.properties.revision === undefined)).toBe(true);
    ed.destroy();
  });

  it("toggling tracked mode off mid-composition falls back to browser commit", () => {
    const ed = setupEditor(plainImeDoc());
    ed.setTrackChanges({ enabled: true, author: "Alice" });
    const block = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: block.id, version: block.version }, offset: 1 },
    });
    const host = (ed as unknown as { host: HTMLElement }).host;
    fireComposition(host, "compositionstart");
    // Toggle off mid-composition.
    ed.setTrackChanges({ enabled: false });
    fireComposition(host, "compositionend", "字");
    // Compositionend with snapshot in place + mode off: we still
    // honour the original tracked decision (snapshot taken at start
    // implies "track this commit"). Result: ins marker still lands.
    // This matches the intuition that pressing the IME's commit key
    // is part of the same edit that started under tracked mode.
    const inserted = (ed.getDocument().body[0] as Paragraph).runs.find(
      (x): x is TextRun => x.kind === "text" && x.text === "字",
    );
    // The insertRun path runs in non-tracked mode at commit time —
    // mode was off when insertRun fired — so NO marker. The behaviour
    // we're documenting: the user's most-recent mode toggle wins.
    expect(inserted?.properties.revision).toBeUndefined();
    ed.destroy();
  });
});

describe("resolveComment / reopenComment", () => {
  function commentedDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [paragraph([text("Body.")])];
    d.comments = {
      0: { id: 0, author: "Alice", body: [paragraph([text("A note.")])] },
    };
    return d;
  }

  it("resolveComment sets done = true", () => {
    const ed = setupEditor(commentedDoc());
    const r = ed.resolveComment(0);
    expect(r.ok).toBe(true);
    expect(ed.getDocument().comments?.[0]?.done).toBe(true);
    ed.destroy();
  });

  it("reopenComment sets done = false", () => {
    const ed = setupEditor(commentedDoc());
    ed.resolveComment(0);
    const r = ed.reopenComment(0);
    expect(r.ok).toBe(true);
    expect(ed.getDocument().comments?.[0]?.done).toBe(false);
    ed.destroy();
  });

  it("fails for an unknown comment id", () => {
    const ed = setupEditor(commentedDoc());
    const r = ed.resolveComment(99);
    expect(r.ok).toBe(false);
    ed.destroy();
  });
});
