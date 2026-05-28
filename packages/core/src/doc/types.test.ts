import {
  appendBlock,
  emptyDocument,
  heading,
  paragraph,
  strong,
  text,
} from "./builders";
import type { Paragraph } from "./types";
import { headingLevelOf, plainText, walk } from "./walk";
import { describe, expect, it } from "vitest";

describe("AST builders", () => {
  it("emptyDocument has one blank paragraph and a single section", () => {
    const doc = emptyDocument();
    expect(doc.body).toHaveLength(1);
    expect(doc.body[0]?.kind).toBe("paragraph");
    expect(doc.sections).toHaveLength(1);
  });

  it("emptyDocument declares the standard styles", () => {
    const doc = emptyDocument();
    const ids = doc.styles.map((s) => s.id);
    expect(ids).toContain("Normal");
    expect(ids).toContain("Heading1");
    expect(ids).toContain("Heading6");
    expect(ids).toContain("Quote");
  });

  it("heading() clamps the level into 1..6 and tags the styleId", () => {
    const h0 = heading(0, [text("zero")]);
    const h7 = heading(7, [text("seven")]);
    expect(h0.properties.styleId).toBe("Heading1");
    expect(h7.properties.styleId).toBe("Heading6");
  });

  it("strong() and text() compose into a paragraph", () => {
    const p = paragraph([text("Hello "), strong("world")]);
    expect(p.runs).toHaveLength(2);
    expect(p.runs[1]).toMatchObject({ kind: "text", properties: { bold: true } });
  });

  it("appendBlock mutates body in place", () => {
    const doc = emptyDocument();
    appendBlock(doc, heading(2, [text("Section")]));
    expect(doc.body).toHaveLength(2);
    expect((doc.body[1] as Paragraph).properties.styleId).toBe("Heading2");
  });
});

describe("walk", () => {
  it("visits every paragraph in body order", () => {
    const doc = emptyDocument();
    appendBlock(doc, heading(1, [text("Title")]));
    appendBlock(doc, paragraph([text("Body.")]));
    const seen: string[] = [];
    walk(doc, {
      paragraph: (p) => {
        seen.push(p.properties.styleId ?? "Normal");
      },
    });
    // includes the initial blank paragraph from emptyDocument
    expect(seen).toEqual(["Normal", "Heading1", "Normal"]);
  });

  it("visits every text run", () => {
    const doc = emptyDocument();
    appendBlock(doc, paragraph([text("a"), text("b"), text("c")]));
    const seen: string[] = [];
    walk(doc, {
      run: (r) => {
        if (r.kind === "text") seen.push(r.text);
      },
    });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("plainText flattens content into a newline-separated string", () => {
    const doc = emptyDocument();
    appendBlock(doc, heading(1, [text("Title")]));
    appendBlock(doc, paragraph([text("Body line.")]));
    expect(plainText(doc)).toBe("\nTitle\nBody line.");
  });
});

describe("headingLevelOf", () => {
  it("recognises Heading1..6 styleIds", () => {
    for (let lv = 1; lv <= 6; lv++) {
      expect(headingLevelOf(heading(lv, []))).toBe(lv);
    }
  });

  it("returns null for non-heading paragraphs", () => {
    expect(headingLevelOf(paragraph([text("hi")]))).toBeNull();
  });
});

describe("AST is JSON-clean", () => {
  it("survives JSON.stringify -> JSON.parse round-trip", () => {
    const doc = emptyDocument();
    appendBlock(doc, heading(2, [text("Section")]));
    appendBlock(
      doc,
      paragraph([text("Hello "), strong("world"), text("!"), { kind: "tab" }]),
    );
    const json = JSON.stringify(doc);
    const back = JSON.parse(json);
    expect(back).toEqual(doc);
  });
});
