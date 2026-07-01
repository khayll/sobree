import { describe, expect, it } from "vitest";
import { defaultStyles } from "./builders";
import { mergeRunStyleLayer, resolveRunStyle, resolveStyleCascade } from "./styles";
import type { NamedStyle } from "./types";

describe("mergeRunStyleLayer — toggle semantics", () => {
  it("absent toggle inherits the base value", () => {
    expect(mergeRunStyleLayer({ bold: true }, {}).bold).toBe(true);
  });

  it("a re-declared `true` toggle XORs (caps-on-caps cancels)", () => {
    expect(mergeRunStyleLayer({ caps: true }, { caps: true }).caps).toBe(false);
    expect(mergeRunStyleLayer({ caps: false }, { caps: true }).caps).toBe(true);
  });

  it("an explicit `false` RESETS the inherited toggle to off", () => {
    // ACM's ACMRef turns off the bold it inherits from Titledocument.
    expect(mergeRunStyleLayer({ bold: true }, { bold: false }).bold).toBe(false);
  });

  it("resolves a style that switches off an inherited toggle to off", () => {
    const styles: NamedStyle[] = [
      { id: "Titledocument", type: "paragraph", displayName: "Title", runDefaults: { bold: true } },
      {
        id: "ACMRef",
        type: "paragraph",
        displayName: "ACM Ref",
        basedOn: "Titledocument",
        runDefaults: { bold: false },
      },
    ];
    expect(resolveStyleCascade(styles, "ACMRef").runDefaults.bold).toBe(false);
    // A sibling that does NOT re-declare keeps the inherited bold.
    styles.push({
      id: "ACMRefHead",
      type: "paragraph",
      displayName: "ACM Ref Head",
      basedOn: "Titledocument",
      runDefaults: {},
    });
    expect(resolveStyleCascade(styles, "ACMRefHead").runDefaults.bold).toBe(true);
  });
});

describe("resolveStyleCascade — built-in defaults", () => {
  const styles = defaultStyles();

  it("Heading1 inherits fontFamily from itself, not Normal", () => {
    const { runDefaults } = resolveStyleCascade(styles, "Heading1");
    expect(runDefaults).toMatchObject({
      bold: true,
      fontFamily: "Helvetica",
      fontSizePt: 24,
    });
  });

  it("Heading6 carries the smallest scaled size", () => {
    const { runDefaults } = resolveStyleCascade(styles, "Heading6");
    expect(runDefaults.fontSizePt).toBe(11);
    expect(runDefaults.bold).toBe(true);
  });

  it("Quote inherits Normal's fontFamily + size, adds italic", () => {
    const { runDefaults } = resolveStyleCascade(styles, "Quote");
    expect(runDefaults).toMatchObject({
      italic: true,
      fontFamily: "Helvetica",
      fontSizePt: 11,
    });
  });

  it("undefined styleId still falls back to Normal", () => {
    const { runDefaults } = resolveStyleCascade(styles, undefined);
    expect(runDefaults).toEqual({ fontFamily: "Helvetica", fontSizePt: 11 });
  });

  it("unknown styleId falls back to Normal too", () => {
    const { runDefaults } = resolveStyleCascade(styles, "DoesNotExist");
    expect(runDefaults).toEqual({ fontFamily: "Helvetica", fontSizePt: 11 });
  });
});

describe("resolveStyleCascade — chain semantics", () => {
  it("walks basedOn chain, leaf overrides base", () => {
    const styles: NamedStyle[] = [
      {
        id: "Normal",
        type: "paragraph",
        displayName: "Normal",
        runDefaults: { fontFamily: "Arial", fontSizePt: 10 },
      },
      {
        id: "Mid",
        type: "paragraph",
        displayName: "Mid",
        basedOn: "Normal",
        runDefaults: { fontFamily: "Georgia" },
      },
      {
        id: "Leaf",
        type: "paragraph",
        displayName: "Leaf",
        basedOn: "Mid",
        runDefaults: { bold: true },
      },
    ];
    const { runDefaults } = resolveStyleCascade(styles, "Leaf");
    expect(runDefaults).toEqual({
      fontFamily: "Georgia",
      fontSizePt: 10,
      bold: true,
    });
  });

  it("a no-basedOn style inherits DocDefaults but NOT Normal (OOXML hierarchy)", () => {
    const styles: NamedStyle[] = [
      {
        id: "DocDefaults",
        type: "paragraph",
        displayName: "DocDefaults",
        paragraphDefaults: { spacing: { lineRule: "auto", line: 240 } },
      },
      {
        id: "Normal",
        type: "paragraph",
        displayName: "Normal",
        basedOn: "DocDefaults",
        paragraphDefaults: { spacing: { afterTwips: 120 } },
      },
      {
        // Stands alone (like a fact-sheet's StatContext) — no basedOn.
        id: "StatContext",
        type: "paragraph",
        displayName: "Stat Context",
        paragraphDefaults: { spacing: { beforeTwips: 60 } },
      },
    ];
    const { paragraphDefaults } = resolveStyleCascade(styles, "StatContext");
    // Gets its own before + DocDefaults' line, but NOT Normal's after=120.
    expect(paragraphDefaults.spacing).toEqual({ beforeTwips: 60, lineRule: "auto", line: 240 });
    expect(paragraphDefaults.spacing?.afterTwips).toBeUndefined();
  });

  it("an unstyled paragraph still picks up Normal (the default style)", () => {
    const styles: NamedStyle[] = [
      { id: "DocDefaults", type: "paragraph", displayName: "DocDefaults" },
      {
        id: "Normal",
        type: "paragraph",
        displayName: "Normal",
        basedOn: "DocDefaults",
        paragraphDefaults: { spacing: { afterTwips: 120 } },
      },
    ];
    const { paragraphDefaults } = resolveStyleCascade(styles, undefined);
    expect(paragraphDefaults.spacing?.afterTwips).toBe(120);
  });

  it("tolerates basedOn cycles (de-duped)", () => {
    const styles: NamedStyle[] = [
      {
        id: "A",
        type: "paragraph",
        displayName: "A",
        basedOn: "B",
        runDefaults: { fontFamily: "X" },
      },
      {
        id: "B",
        type: "paragraph",
        displayName: "B",
        basedOn: "A",
        runDefaults: { fontFamily: "Y" },
      },
    ];
    expect(() => resolveStyleCascade(styles, "A")).not.toThrow();
    const { runDefaults } = resolveStyleCascade(styles, "A");
    expect(runDefaults.fontFamily).toBe("X"); // leaf wins
  });

  it("merges paragraphDefaults across the chain too", () => {
    const styles: NamedStyle[] = [
      {
        id: "Normal",
        type: "paragraph",
        displayName: "Normal",
        paragraphDefaults: { alignment: "left" },
      },
      {
        id: "Centred",
        type: "paragraph",
        displayName: "Centred",
        basedOn: "Normal",
        paragraphDefaults: { alignment: "center" },
      },
    ];
    const { paragraphDefaults } = resolveStyleCascade(styles, "Centred");
    expect(paragraphDefaults.alignment).toBe("center");
  });

  it("accepts a SobreeDocument shape too (not just an array)", () => {
    const { runDefaults } = resolveStyleCascade(
      { styles: defaultStyles() } as unknown as Parameters<typeof resolveStyleCascade>[0],
      "Heading2",
    );
    expect(runDefaults.fontFamily).toBe("Helvetica");
  });
});

describe("resolveRunStyle — character (rStyle) resolution", () => {
  const styles: NamedStyle[] = [
    {
      id: "DocDefaults",
      type: "paragraph",
      displayName: "Document defaults",
      runDefaults: { fontFamily: "Times New Roman", fontSizePt: 12 },
    },
    { id: "Normal", type: "paragraph", displayName: "Normal", basedOn: "DocDefaults" },
    {
      id: "Hyperlink",
      type: "character",
      displayName: "Hyperlink",
      runDefaults: { underline: "single" },
    },
    // colour-only char style — the contact-line "Blue" case
    { id: "Blue", type: "character", displayName: "Blue", runDefaults: { color: "#357CA2" } },
    // basedOn another character style: inherits + overrides
    {
      id: "BlueLink",
      type: "character",
      displayName: "BlueLink",
      basedOn: "Hyperlink",
      runDefaults: { color: "#357CA2" },
    },
  ];

  it("returns only the char style's own props — NOT the Normal/DocDefaults anchor", () => {
    // Must NOT drag Times/12pt onto the run (it inherits the paragraph font).
    expect(resolveRunStyle(styles, "Blue")).toEqual({ color: "#357CA2" });
  });

  it("merges the char style's basedOn chain (derived wins)", () => {
    expect(resolveRunStyle(styles, "BlueLink")).toEqual({ underline: "single", color: "#357CA2" });
  });

  it("returns {} for an unknown char style id", () => {
    expect(resolveRunStyle(styles, "Nope")).toEqual({});
  });
});
