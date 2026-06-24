import { describe, expect, it } from "vitest";
import { normalizePartPath, readBlipEmbedPart } from "./relationships";
import { el } from "./testUtil";

describe("relationships — normalizePartPath", () => {
  it("drops a leading package slash", () => {
    expect(normalizePartPath("/word/media/image1.png")).toBe("word/media/image1.png");
  });

  it("leaves an already word-rooted path as-is", () => {
    expect(normalizePartPath("word/media/image1.png")).toBe("word/media/image1.png");
  });

  it("roots a document-relative target under word/", () => {
    expect(normalizePartPath("media/image1.png")).toBe("word/media/image1.png");
  });
});

describe("relationships — readBlipEmbedPart", () => {
  const rels = new Map([["rId7", "media/image1.png"]]);

  it("resolves r:embed through the rels map and normalises", () => {
    const blip = el(`<a:blip r:embed="rId7"/>`);
    expect(readBlipEmbedPart(blip, rels)).toBe("word/media/image1.png");
  });

  it("returns null when the blip has no embed id", () => {
    expect(readBlipEmbedPart(el("<a:blip/>"), rels)).toBeNull();
  });

  it("returns null when the embed id isn't in rels", () => {
    expect(readBlipEmbedPart(el(`<a:blip r:embed="rId99"/>`), rels)).toBeNull();
  });
});
