import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Selection } from "../doc/api";
import { History } from "./history";

function makeHistory(ydoc: Y.Doc): History {
  return new History({
    ydoc,
    // Long capture window so edits coalesce unless explicitly broken.
    coalesceIdleMs: 5000,
    captureSelection: () => null as unknown as Selection,
    restoreSelection: () => {},
  });
}

/** A tracked local edit (origin "local" is what History observes). */
function edit(ydoc: Y.Doc, value: string): void {
  ydoc.transact(() => ydoc.getMap("meta").set("k", value), "local");
}

describe("History selection capture — before/after", () => {
  // Build a History wired to scriptable capture functions so we can assert
  // exactly which selection (pre- or post-edit) is restored on undo vs redo.
  function wired() {
    const ydoc = new Y.Doc();
    let live: string | null = "pre"; // what captureSelection() returns "now"
    const restored: string[] = [];
    const h = new History({
      ydoc,
      coalesceIdleMs: 5000,
      captureSelection: () => live as unknown as Selection,
      capturePreEditSelection: () => "PRE" as unknown as Selection,
      restoreSelection: (s) => restored.push(s as unknown as string),
      onGroupSettled: () => {},
    });
    const setLive = (v: string) => {
      live = v;
    };
    return { ydoc, h, restored, setLive };
  }

  it("undo restores the pre-edit selection; redo restores the post-edit one", () => {
    const { ydoc, h, restored, setLive } = wired();
    setLive("POST"); // live (post-edit) selection at stack-item-added
    edit(ydoc, "x");

    h.undo();
    expect(restored).toEqual(["PRE"]); // undo → where the edit began
    h.redo();
    expect(restored).toEqual(["PRE", "POST"]); // redo → where it ended
  });

  it("a coalesced burst keeps the first pre-edit but extends post-edit", () => {
    const { ydoc, h, restored, setLive } = wired();
    setLive("POST-1");
    edit(ydoc, "1"); // opens the group: before=PRE, after=POST-1
    setLive("POST-2");
    edit(ydoc, "2"); // coalesces: after extended to POST-2

    h.undo();
    expect(restored).toEqual(["PRE"]); // still the group's start
    h.redo();
    expect(restored).toEqual(["PRE", "POST-2"]); // tail of the whole burst
  });
});

describe("History.stopCapturing", () => {
  it("makes the next edit a separate undo step", () => {
    const ydoc = new Y.Doc();
    const meta = ydoc.getMap<string>("meta");
    const h = makeHistory(ydoc);

    edit(ydoc, "1");
    h.stopCapturing(); // close the group — mimics the caret moving to another box
    edit(ydoc, "2");
    expect(meta.get("k")).toBe("2");

    h.undo();
    expect(meta.get("k")).toBe("1"); // only the second edit reverted
    h.undo();
    expect(meta.get("k")).toBeUndefined(); // first edit reverted by a second undo
  });

  it("without it, coalesced edits revert together in one undo", () => {
    const ydoc = new Y.Doc();
    const meta = ydoc.getMap<string>("meta");
    const h = makeHistory(ydoc);

    edit(ydoc, "1");
    edit(ydoc, "2"); // within the capture window → same undo step
    h.undo();
    expect(meta.get("k")).toBeUndefined(); // both gone in one undo
  });
});
