import { describe, expect, it } from "vitest";
import {
  columnBreak,
  commentRef,
  field,
  footnoteRef,
  hyperlink,
  image,
  namedStyle,
  paragraph,
  sectionBreak,
  tab,
  table,
  tableCell,
  tableRow,
  text,
} from "./index";

describe("inline builders", () => {
  it("hyperlink wraps children with href + default properties", () => {
    const link = hyperlink("https://x.test", [text("click")]);
    expect(link).toEqual({
      kind: "hyperlink",
      href: "https://x.test",
      children: [{ kind: "text", text: "click", properties: {} }],
      properties: {},
    });
  });

  it("field carries instruction; omits cached when not given", () => {
    expect(field("PAGE")).toEqual({ kind: "field", instruction: "PAGE", properties: {} });
    expect(field("PAGE", "3")).toEqual({
      kind: "field",
      instruction: "PAGE",
      cached: "3",
      properties: {},
    });
  });

  it("tab + columnBreak", () => {
    expect(tab()).toEqual({ kind: "tab", properties: {} });
    expect(columnBreak()).toEqual({ kind: "break", type: "column" });
  });

  it("image defaults placement to inline and only emits set optionals", () => {
    expect(image("word/media/image1.png", { widthEmu: 914400, heightEmu: 457200 })).toEqual({
      kind: "drawing",
      partPath: "word/media/image1.png",
      widthEmu: 914400,
      heightEmu: 457200,
      placement: "inline",
    });
    const floated = image("p.png", {
      widthEmu: 1,
      heightEmu: 2,
      altText: "logo",
      placement: "floatLeft",
    });
    expect(floated.placement).toBe("floatLeft");
    expect(floated.altText).toBe("logo");
  });

  it("footnoteRef / commentRef carry their id", () => {
    expect(footnoteRef(2)).toEqual({ kind: "footnoteRef", id: 2, properties: {} });
    expect(commentRef(5)).toEqual({ kind: "commentRef", id: 5, properties: {} });
  });
});

describe("table builders", () => {
  it("tableCell defaults to a single empty paragraph", () => {
    expect(tableCell()).toEqual({ content: [paragraph()] });
  });

  it("tableCell carries shading + borders without a content arg override", () => {
    const cell = tableCell([paragraph([text("hi")])], {
      shading: { pattern: "clear", fill: "#FFCD00" },
      gridSpan: 2,
    });
    expect(cell.shading).toEqual({ pattern: "clear", fill: "#FFCD00" });
    expect(cell.gridSpan).toBe(2);
    expect(cell.content).toHaveLength(1);
  });

  it("tableRow flags header only when asked", () => {
    expect(tableRow([tableCell()])).toEqual({ cells: [tableCell()] });
    expect(tableRow([tableCell()], { isHeader: true }).isHeader).toBe(true);
  });

  it("table derives an equal-width grid from the widest row", () => {
    const t = table([tableRow([tableCell(), tableCell(), tableCell()]), tableRow([tableCell()])]);
    expect(t.grid).toHaveLength(3);
    expect(new Set(t.grid).size).toBe(1); // all equal
    expect(t.grid.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(9360);
  });

  it("table grid accounts for gridSpan", () => {
    const t = table([tableRow([tableCell([], { gridSpan: 3 })])]);
    expect(t.grid).toHaveLength(3);
  });

  it("table honours an explicit grid + properties", () => {
    const t = table([tableRow([tableCell(), tableCell()])], {
      grid: [2000, 4000],
      properties: { styleId: "TableGrid" },
    });
    expect(t.grid).toEqual([2000, 4000]);
    expect(t.properties.styleId).toBe("TableGrid");
  });
});

describe("block + style builders", () => {
  it("sectionBreak targets a section index", () => {
    expect(sectionBreak(1)).toEqual({ kind: "section_break", toSectionIndex: 1 });
  });

  it("namedStyle defaults type=paragraph and displayName=id", () => {
    expect(namedStyle("Caption")).toEqual({
      id: "Caption",
      type: "paragraph",
      displayName: "Caption",
    });
  });

  it("namedStyle carries cascade + table fields when given", () => {
    const s = namedStyle("GoldGrid", {
      type: "table",
      displayName: "Gold Grid",
      basedOn: "TableNormal",
      tableStyle: { shading: { pattern: "clear", fill: "#FFCD00" } },
    });
    expect(s.type).toBe("table");
    expect(s.basedOn).toBe("TableNormal");
    expect(s.tableStyle?.shading?.fill).toBe("#FFCD00");
  });
});
