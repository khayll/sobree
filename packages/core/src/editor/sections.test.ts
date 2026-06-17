import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { emptyDocument } from "../doc/builders";
import type { SectionProperties } from "../doc/types";
import { HeadlessSobree } from "../headless";
import { Editor } from "./";
import { mergeSectionProps } from "./internal/mutations";

const baseSection = (): SectionProperties => ({
  pageSize: { wTwips: 11906, hTwips: 16838, orientation: "portrait" },
  pageMargins: {
    topTwips: 1440,
    rightTwips: 1440,
    bottomTwips: 1440,
    leftTwips: 1440,
    headerTwips: 720,
    footerTwips: 720,
    gutterTwips: 0,
  },
  headerRefs: [],
  footerRefs: [],
});

describe("mergeSectionProps", () => {
  it("field-merges pageSize (partial stays valid)", () => {
    const out = mergeSectionProps(baseSection(), { pageSize: { orientation: "landscape" } });
    expect(out.pageSize).toEqual({ wTwips: 11906, hTwips: 16838, orientation: "landscape" });
  });

  it("field-merges pageMargins (other sides untouched)", () => {
    const out = mergeSectionProps(baseSection(), { pageMargins: { topTwips: 720 } });
    expect(out.pageMargins.topTwips).toBe(720);
    expect(out.pageMargins.leftTwips).toBe(1440); // unchanged
  });

  it("replaces columns wholesale and clears them with undefined", () => {
    const withCols = mergeSectionProps(baseSection(), { columns: { count: 2, spaceTwips: 720 } });
    expect(withCols.columns).toEqual({ count: 2, spaceTwips: 720 });
    const cleared = mergeSectionProps(withCols, { columns: undefined });
    expect("columns" in cleared).toBe(false);
  });

  it("sets and clears the optional vAlign", () => {
    const centred = mergeSectionProps(baseSection(), { vAlign: "center" });
    expect(centred.vAlign).toBe("center");
    expect("vAlign" in mergeSectionProps(centred, { vAlign: undefined })).toBe(false);
  });

  it("leaves untouched fields alone", () => {
    const out = mergeSectionProps(baseSection(), { type: "nextPage" });
    expect(out.type).toBe("nextPage");
    expect(out.headerRefs).toEqual([]);
    expect(out.pageSize.orientation).toBe("portrait");
  });
});

describe("applySectionProperties (headless)", () => {
  const seed = () => {
    const peer = new HeadlessSobree(new Y.Doc(), { initialDocument: emptyDocument() });
    return peer;
  };

  it("merges into the section and re-reads from the document", () => {
    const peer = seed();
    try {
      const res = peer.applySectionProperties(0, {
        pageMargins: { topTwips: 567 },
        vAlign: "center",
      });
      expect(res.ok).toBe(true);
      const section = peer.getDocument().sections[0];
      expect(section?.pageMargins.topTwips).toBe(567);
      expect(section?.pageMargins.bottomTwips).toBe(1440); // default, untouched
      expect(section?.vAlign).toBe("center");
    } finally {
      peer.destroy();
    }
  });

  it("fails for an out-of-range section index", () => {
    const peer = seed();
    try {
      const res = peer.applySectionProperties(3, { vAlign: "bottom" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("invalid-state");
    } finally {
      peer.destroy();
    }
  });

  it("mirrors the section change to the Y.Doc (parity for a joining peer)", () => {
    const ydocA = new Y.Doc();
    const peerA = new HeadlessSobree(ydocA, { initialDocument: emptyDocument() });
    try {
      peerA.applySectionProperties(0, { pageSize: { orientation: "landscape" } });

      const ydocB = new Y.Doc();
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
      const peerB = new HeadlessSobree(ydocB);
      try {
        expect(peerB.getDocument().sections[0]?.pageSize.orientation).toBe("landscape");
      } finally {
        peerB.destroy();
      }
    } finally {
      peerA.destroy();
    }
  });
});

describe("editor.sections.setProperties (DOM editor)", () => {
  it("merges via the sub-object and survives a round-trip through getDocument", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor(host, { initialDocument: emptyDocument() });
    try {
      const res = editor.sections.setProperties(0, {
        pageSize: { wTwips: 15840, hTwips: 12240, orientation: "landscape" },
        pageMargins: { topTwips: 567 },
      });
      expect(res.ok).toBe(true);
      const section = editor.getDocument().sections[0];
      expect(section?.pageSize.orientation).toBe("landscape");
      expect(section?.pageSize.wTwips).toBe(15840);
      expect(section?.pageMargins.topTwips).toBe(567);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("fails for an out-of-range section index", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor(host, { initialDocument: emptyDocument() });
    try {
      const res = editor.sections.setProperties(9, { vAlign: "center" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("invalid-state");
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
