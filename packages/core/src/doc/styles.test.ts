import { describe, expect, it } from "vitest";
import { resolveStyleCascade } from "./styles";
import { defaultStyles } from "./builders";
import type { NamedStyle } from "./types";

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
