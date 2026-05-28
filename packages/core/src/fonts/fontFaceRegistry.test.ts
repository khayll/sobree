import { describe, expect, it } from "vitest";
import { FontFaceRegistry } from "./fontFaceRegistry";

describe("FontFaceRegistry.sync", () => {
  it("survives undefined fonts (doc with no fonts field)", () => {
    const reg = new FontFaceRegistry();
    // Some doc-construction paths (Y.Doc projections, partial
    // setDocument calls from headless agents) hand us a doc without
    // `fonts` populated. The type contract says required, but the
    // runtime needs to be defensive — a crash here taints every
    // setDocument call that round-trips such a doc.
    expect(() =>
      reg.sync(undefined as unknown as never, undefined as unknown as never),
    ).not.toThrow();
    reg.destroy();
  });

  it("survives an empty font list", () => {
    const reg = new FontFaceRegistry();
    expect(() => reg.sync([], {})).not.toThrow();
    reg.destroy();
  });

  it("is idempotent for the same input", () => {
    const reg = new FontFaceRegistry();
    reg.sync([], {});
    // Second call with the same key short-circuits; no DOM churn.
    expect(() => reg.sync([], {})).not.toThrow();
    reg.destroy();
  });
});
