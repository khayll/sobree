import { describe, expect, it } from "vitest";
import { canEmbed, readFsType } from "./fsType";

/**
 * Build the smallest possible TTF/OTF that has a valid OS/2 table at a
 * known offset, with the given `fsType` value.
 *
 * Layout:
 *   [0..12)   sfnt header (sfntVersion=0x00010000, numTables=1, …).
 *   [12..28)  one table directory entry: tag="OS/2", offset=28, length=10.
 *   [28..38)  OS/2 table: version + xAvg + weight + width + fsType.
 */
function makeFontWithFsType(fsType: number, sfnt = 0x00010000): Uint8Array {
  const buf = new ArrayBuffer(40);
  const v = new DataView(buf);
  // Header.
  v.setUint32(0, sfnt);
  v.setUint16(4, 1); // numTables
  v.setUint16(6, 16); // searchRange (don't care for our purposes)
  v.setUint16(8, 0);
  v.setUint16(10, 0);
  // Table dir entry — "OS/2" is 0x4F532F32.
  v.setUint32(12, 0x4f532f32);
  v.setUint32(16, 0); // checksum
  v.setUint32(20, 28); // offset
  v.setUint32(24, 10); // length
  // OS/2 table.
  v.setUint16(28, 4); // version
  v.setInt16(30, 0); // xAvgCharWidth
  v.setUint16(32, 400); // usWeightClass
  v.setUint16(34, 5); // usWidthClass
  v.setUint16(36, fsType); // fsType
  return new Uint8Array(buf);
}

describe("readFsType", () => {
  it("reads installable (0)", () => {
    expect(readFsType(makeFontWithFsType(0x0000))).toBe(0);
  });

  it("reads restricted (0x0002)", () => {
    expect(readFsType(makeFontWithFsType(0x0002))).toBe(0x0002);
  });

  it("reads editable (0x0008)", () => {
    expect(readFsType(makeFontWithFsType(0x0008))).toBe(0x0008);
  });

  it("reads OpenType (CFF) sfnt version too", () => {
    expect(readFsType(makeFontWithFsType(0x0000, 0x4f54544f))).toBe(0);
  });

  it("returns null for unknown sfnt magic", () => {
    expect(readFsType(makeFontWithFsType(0, 0xdeadbeef))).toBeNull();
  });

  it("returns null for truncated input", () => {
    expect(readFsType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("returns null when OS/2 table is missing", () => {
    // Build a font with a single non-OS/2 table.
    const buf = new ArrayBuffer(40);
    const v = new DataView(buf);
    v.setUint32(0, 0x00010000);
    v.setUint16(4, 1);
    v.setUint32(12, 0x68656164); // "head"
    v.setUint32(20, 28);
    v.setUint32(24, 10);
    expect(readFsType(new Uint8Array(buf))).toBeNull();
  });
});

describe("canEmbed", () => {
  it("installable → allowed=true, mode=installable", () => {
    expect(canEmbed(0x0000)).toMatchObject({ allowed: true, mode: "installable" });
  });

  it("restricted (0x0002) → allowed=false", () => {
    const r = canEmbed(0x0002);
    expect(r.allowed).toBe(false);
    expect(r.mode).toBe("restricted");
  });

  it("preview & print (0x0004) → allowed=true, mode=preview", () => {
    expect(canEmbed(0x0004)).toMatchObject({ allowed: true, mode: "preview" });
  });

  it("editable (0x0008) → allowed=true, mode=editable", () => {
    expect(canEmbed(0x0008)).toMatchObject({ allowed: true, mode: "editable" });
  });

  it("noSubset bit (0x0100) reflected in noSubset:true", () => {
    expect(canEmbed(0x0100)).toMatchObject({ noSubset: true, mode: "installable" });
  });

  it("bitmap-only bit (0x0200) reflected", () => {
    expect(canEmbed(0x0200)).toMatchObject({ bitmapOnly: true });
  });

  it("multiple licence bits → most restrictive wins", () => {
    // 0x0002 (restricted) + 0x0008 (editable) → restricted.
    expect(canEmbed(0x000a).mode).toBe("restricted");
  });

  it("null input fails closed (treated as restricted)", () => {
    expect(canEmbed(null)).toMatchObject({ allowed: false, mode: "restricted" });
  });
});
