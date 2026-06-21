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
