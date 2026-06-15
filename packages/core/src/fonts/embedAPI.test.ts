/**
 * Direct tests for `embedFontIntoDoc` + `removeFontFromDoc` — the
 * pure functions the Editor wraps. Exercises licence-check, partPath
 * allocation, declaration merging, and the "no usable face" no-op
 * path, all without mounting an Editor.
 */
import { describe, expect, it } from "vitest";
import { emptyDocument } from "../doc/builders";
import { embedFontIntoDoc, removeFontFromDoc } from "./embedAPI";

/**
 * Build a minimal 40-byte TTF/OTF with a valid sfnt header and an
 * OS/2 table carrying the given `fsType`. Just enough to satisfy
 * `readFsType()`; not a renderable font.
 */
function makeFontWithFsType(fsType: number): Uint8Array {
  const buf = new ArrayBuffer(40);
  const v = new DataView(buf);
  v.setUint32(0, 0x00010000); // sfnt version
  v.setUint16(4, 1); // numTables
  v.setUint32(12, 0x4f532f32); // "OS/2"
  v.setUint32(20, 28); // table offset
  v.setUint32(24, 10); // length
  v.setUint16(36, fsType);
  return new Uint8Array(buf);
}

describe("embedFontIntoDoc", () => {
  it("returns the same doc reference when no faces are provided", () => {
    const doc = emptyDocument();
    const result = embedFontIntoDoc(doc, "Empty", {});
    expect(result.next).toBe(doc);
    expect(result.warnings).toEqual([]);
  });

  it("adds a declaration with embed.regular for installable fsType", () => {
    const doc = emptyDocument();
    const result = embedFontIntoDoc(doc, "MyFont", {
      regular: makeFontWithFsType(0x0000),
    });
    expect(result.next).not.toBe(doc);
    expect(result.next.fonts).toHaveLength(1);
    const decl = result.next.fonts[0]!;
    expect(decl.name).toBe("MyFont");
    expect(decl.embed?.regular?.partPath).toMatch(/^word\/fonts\/font\d+\.odttf$/);
    expect(decl.embed?.regular?.fontKey).toMatch(
      /^\{[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\}$/,
    );
    expect(result.warnings).toEqual([]);
  });

  it("refuses restricted faces and reports a warning", () => {
    const doc = emptyDocument();
    const result = embedFontIntoDoc(doc, "Locked", {
      regular: makeFontWithFsType(0x0002),
    });
    // No face accepted → same doc back, warning recorded.
    expect(result.next).toBe(doc);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Locked");
  });

  it("force-embeds restricted faces with allowRestricted", () => {
    const doc = emptyDocument();
    const result = embedFontIntoDoc(
      doc,
      "Locked",
      { regular: makeFontWithFsType(0x0002) },
      { allowRestricted: true },
    );
    expect(result.next.fonts).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("merges faces into an existing declaration of the same name", () => {
    const doc = emptyDocument();
    const a = embedFontIntoDoc(doc, "MyFont", {
      regular: makeFontWithFsType(0x0000),
    });
    const b = embedFontIntoDoc(a.next, "MyFont", {
      bold: makeFontWithFsType(0x0000),
    });
    expect(b.next.fonts).toHaveLength(1);
    const decl = b.next.fonts[0]!;
    expect(decl.embed?.regular).toBeDefined();
    expect(decl.embed?.bold).toBeDefined();
    // Distinct part paths — each face got its own slot.
    expect(decl.embed?.regular?.partPath).not.toBe(decl.embed?.bold?.partPath);
  });

  it("allocates a fresh part path when one is already taken", () => {
    const doc = emptyDocument();
    doc.rawParts["word/fonts/font1.odttf"] = new Uint8Array([0]);
    const result = embedFontIntoDoc(doc, "Squeeze", {
      regular: makeFontWithFsType(0x0000),
    });
    const path = result.next.fonts[0]!.embed!.regular!.partPath;
    expect(path).toBe("word/fonts/font2.odttf");
  });

  it("does not mutate the input document", () => {
    const doc = emptyDocument();
    const beforeFonts = doc.fonts;
    const beforeRawPartKeys = Object.keys(doc.rawParts);
    embedFontIntoDoc(doc, "MyFont", { regular: makeFontWithFsType(0x0000) });
    expect(doc.fonts).toBe(beforeFonts);
    expect(Object.keys(doc.rawParts)).toEqual(beforeRawPartKeys);
  });
});

describe("removeFontFromDoc", () => {
  it("returns the same doc when the name isn't present", () => {
    const doc = emptyDocument();
    expect(removeFontFromDoc(doc, "Missing")).toBe(doc);
  });

  it("drops the matching declaration", () => {
    const doc = emptyDocument();
    const withFont = embedFontIntoDoc(doc, "Wipe", {
      regular: makeFontWithFsType(0x0000),
    });
    const next = removeFontFromDoc(withFont.next, "Wipe");
    expect(next).not.toBe(withFont.next);
    expect(next.fonts).toHaveLength(0);
  });

  it("leaves rawParts intact (caller does GC via pruneOrphanParts)", () => {
    const doc = emptyDocument();
    const withFont = embedFontIntoDoc(doc, "Wipe", {
      regular: makeFontWithFsType(0x0000),
    });
    const partPath = withFont.next.fonts[0]!.embed!.regular!.partPath;
    const next = removeFontFromDoc(withFont.next, "Wipe");
    expect(next.rawParts[partPath]).toBeDefined();
  });
});
