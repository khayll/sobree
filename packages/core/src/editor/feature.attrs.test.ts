import { describe, expect, it } from "vitest";
import { appendBlock, emptyDocument, heading, paragraph, text } from "../doc/builders";
import type { Paragraph, SobreeDocument } from "../doc/types";
import { Editor } from "./";

function titledDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [];
  appendBlock(d, heading(1, [text("Title")]));
  appendBlock(d, paragraph([text("Body.")]));
  return d;
}

function setupEditor(doc: SobreeDocument): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor(host, { initialDocument: doc });
}

describe("applyBlockProperties (with optimistic locking)", () => {
  it("merges alignment onto the target paragraph", () => {
    const ed = setupEditor(titledDoc());
    const ref = ed.getBlock(1);
    const r = ed.applyBlockProperties([ref], { alignment: "center" });
    expect(r.ok).toBe(true);
    const para = ed.getDocument().body[1] as Paragraph;
    expect(para.properties.alignment).toBe("center");
    ed.destroy();
  });

  it("preserves prior properties when merging (using fresh refs each call)", () => {
    const ed = setupEditor(titledDoc());
    const first = ed.applyBlockProperties([ed.getBlock(1)], { alignment: "center" });
    expect(first.ok).toBe(true);
    const second = ed.applyBlockProperties([ed.getBlock(1)], {
      spacing: { line: 360, lineRule: "auto" },
    });
    expect(second.ok).toBe(true);
    const para = ed.getDocument().body[1] as Paragraph;
    expect(para.properties.alignment).toBe("center");
    expect(para.properties.spacing?.line).toBe(360);
    ed.destroy();
  });

  it("removes a property when the value is undefined", () => {
    const ed = setupEditor(titledDoc());
    ed.applyBlockProperties([ed.getBlock(1)], { alignment: "center" });
    ed.applyBlockProperties([ed.getBlock(1)], { alignment: undefined });
    const para = ed.getDocument().body[1] as Paragraph;
    expect(para.properties.alignment).toBeUndefined();
    ed.destroy();
  });

  it("returns optimistic-lock failure when using a stale ref", () => {
    const ed = setupEditor(titledDoc());
    const stale = ed.getBlock(1); // version 0
    ed.applyBlockProperties([ed.getBlock(1)], { alignment: "center" }); // bumps to v1
    const r = ed.applyBlockProperties([stale], { alignment: "right" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "optimistic-lock") {
      expect(r.error.conflicts[0]?.blockId).toBe(stale.id);
      expect(r.error.conflicts[0]?.expected).toBe(0);
      expect(r.error.conflicts[0]?.actual).toBe(1);
    } else {
      throw new Error("expected optimistic-lock error");
    }
    ed.destroy();
  });

  it("returns unknown-block when the ref's id was removed", () => {
    const ed = setupEditor(titledDoc());
    const doomed = ed.getBlock(1);
    ed.deleteBlock(ed.getBlock(1));
    const r = ed.applyBlockProperties([doomed], { alignment: "center" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "optimistic-lock") {
      expect(r.error.conflicts[0]?.actual).toBeNull();
    } else {
      throw new Error("expected optimistic-lock with actual=null");
    }
    ed.destroy();
  });
});
