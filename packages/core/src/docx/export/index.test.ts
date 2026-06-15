import { describe, expect, it } from "vitest";
import { appendBlock, emptyDocument, heading, paragraph, strong, text } from "../../doc/builders";
import type { SobreeDocument } from "../../doc/types";
import { exportDocx } from "./index";

function buildSample(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = [];
  appendBlock(doc, heading(1, [text("Title")]));
  appendBlock(doc, paragraph([text("Hello "), strong("world"), text(".")]));
  return doc;
}

// .docx files are ZIP archives, which begin with the local-file-header
// signature "PK\x03\x04".
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

describe("exportDocx", () => {
  it("returns the { blob, bytes, warnings } result shape", () => {
    const result = exportDocx(buildSample());
    expect(result).toHaveProperty("blob");
    expect(result).toHaveProperty("bytes");
    expect(result).toHaveProperty("warnings");
  });

  it("produces non-empty bytes as a Uint8Array", () => {
    const { bytes } = exportDocx(buildSample());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("produces bytes with the ZIP magic header", () => {
    const { bytes } = exportDocx(buildSample());
    expect(Array.from(bytes.slice(0, 4))).toEqual(ZIP_MAGIC);
  });

  it("returns a Blob", () => {
    const { blob } = exportDocx(buildSample());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("returns warnings as an array", () => {
    const { warnings } = exportDocx(buildSample());
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("exports an empty document without throwing", () => {
    const { bytes } = exportDocx(emptyDocument());
    expect(bytes.length).toBeGreaterThan(0);
  });
});
