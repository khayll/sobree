import { describe, expect, it } from "vitest";
import { resolveTableCellFormat, resolveTableStyle } from "./tableStyle";
import type { NamedStyle, TableLook, TableStyleDefinition } from "./types";

/**
 * A representative "header + banded grid" table style: a coloured first
 * row, white / grey alternating horizontal banding, a white last row, and
 * a thin grey grid. The resolver must turn this + a `<w:tblLook>` into the
 * right per-cell fill.
 */
const GOLD: TableStyleDefinition = {
  borders: {
    insideH: { style: "single", sizeEighthsOfPt: 4, color: "#62666A" },
    insideV: { style: "single", sizeEighthsOfPt: 4, color: "#62666A" },
  },
  rowBandSize: 1,
  conditional: {
    firstRow: { shading: { pattern: "clear", fill: "#FFCD00" } },
    lastRow: { shading: { pattern: "clear", fill: "#FFFFFF" } },
    band1Horz: { shading: { pattern: "clear", fill: "#FFFFFF" } },
    band2Horz: { shading: { pattern: "clear", fill: "#E3E4E4" } },
  },
};

// firstRow on, no last row, row banding on (noHBand=0), col banding off.
const LOOK: TableLook = { firstRow: true, hBand: true };

const fillAt = (rowIndex: number, look = LOOK, def = GOLD, rowCount = 5, colCount = 3) =>
  resolveTableCellFormat(def, look, { rowIndex, colIndex: 0, rowCount, colCount }).shading?.fill;

describe("resolveTableCellFormat — horizontal banding + first row", () => {
  it("paints the first row with the firstRow conditional (gold header)", () => {
    expect(fillAt(0)).toBe("#FFCD00");
  });

  it("excludes the first row from banding so band1 starts at the 2nd row", () => {
    // Row 0 is firstRow (gold). Banding counts from row 1: band1 (white),
    // band2 (grey), band1 (white), …
    expect(fillAt(1)).toBe("#FFFFFF"); // band1
    expect(fillAt(2)).toBe("#E3E4E4"); // band2
    expect(fillAt(3)).toBe("#FFFFFF"); // band1
  });

  it("lets lastRow win over banding on the final row", () => {
    const look: TableLook = { firstRow: true, lastRow: true, hBand: true };
    expect(fillAt(4, look)).toBe("#FFFFFF"); // lastRow, not a band
  });

  it("applies no fill when the look disables the first row", () => {
    // firstRow OFF → row 0 is just band1.
    const look: TableLook = { hBand: true };
    expect(fillAt(0, look)).toBe("#FFFFFF"); // band1 (counts from row 0)
    expect(fillAt(1, look)).toBe("#E3E4E4"); // band2
  });

  it("honours a larger rowBandSize (2 rows per band)", () => {
    const def: TableStyleDefinition = { ...GOLD, rowBandSize: 2 };
    const look: TableLook = { hBand: true };
    expect(fillAt(0, look, def)).toBe("#FFFFFF"); // band1 rows 0-1
    expect(fillAt(1, look, def)).toBe("#FFFFFF");
    expect(fillAt(2, look, def)).toBe("#E3E4E4"); // band2 rows 2-3
    expect(fillAt(3, look, def)).toBe("#E3E4E4");
  });
});

describe("resolveTableCellFormat — corners + columns", () => {
  const def: TableStyleDefinition = {
    conditional: {
      firstRow: { shading: { pattern: "clear", fill: "#111111" } },
      firstCol: { shading: { pattern: "clear", fill: "#222222" } },
      nwCell: { shading: { pattern: "clear", fill: "#333333" } },
    },
  };

  it("ranks the corner cell above first row and first column", () => {
    const look: TableLook = { firstRow: true, firstColumn: true };
    const fmt = resolveTableCellFormat(def, look, {
      rowIndex: 0,
      colIndex: 0,
      rowCount: 3,
      colCount: 3,
    });
    expect(fmt.shading?.fill).toBe("#333333"); // nwCell wins
  });

  it("ranks the first row above the first column off the corner", () => {
    const look: TableLook = { firstRow: true, firstColumn: true };
    const fmt = resolveTableCellFormat(def, look, {
      rowIndex: 0,
      colIndex: 1,
      rowCount: 3,
      colCount: 3,
    });
    expect(fmt.shading?.fill).toBe("#111111"); // firstRow
  });
});

describe("resolveTableStyle — basedOn merge", () => {
  it("merges a derived style's conditionals over its base", () => {
    const styles: NamedStyle[] = [
      {
        id: "Base",
        type: "table",
        displayName: "Base",
        tableStyle: {
          rowBandSize: 1,
          conditional: {
            firstRow: { shading: { pattern: "clear", fill: "#AAAAAA" } },
            band1Horz: { shading: { pattern: "clear", fill: "#BBBBBB" } },
          },
        },
      },
      {
        id: "Derived",
        type: "table",
        displayName: "Derived",
        basedOn: "Base",
        tableStyle: {
          conditional: { firstRow: { shading: { pattern: "clear", fill: "#CCCCCC" } } },
        },
      },
    ];
    const def = resolveTableStyle(styles, "Derived");
    expect(def?.conditional?.firstRow?.shading?.fill).toBe("#CCCCCC"); // overridden
    expect(def?.conditional?.band1Horz?.shading?.fill).toBe("#BBBBBB"); // inherited
    expect(def?.rowBandSize).toBe(1); // inherited
  });

  it("returns null for an unknown style id", () => {
    expect(resolveTableStyle([], "Nope")).toBeNull();
  });

  it("merges cell margins field-by-field up the chain", () => {
    const styles: NamedStyle[] = [
      {
        id: "Base",
        type: "table",
        displayName: "Base",
        tableStyle: { cellMargins: { topTwips: 100, leftTwips: 108 } },
      },
      {
        id: "Derived",
        type: "table",
        displayName: "Derived",
        basedOn: "Base",
        tableStyle: { cellMargins: { topTwips: 144 } },
      },
    ];
    expect(resolveTableStyle(styles, "Derived")?.cellMargins).toEqual({
      topTwips: 144, // overridden
      leftTwips: 108, // inherited
    });
  });
});
