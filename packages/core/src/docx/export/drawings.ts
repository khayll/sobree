import type { DrawingRun } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { el, escapeXmlText } from "../shared/xml";

/**
 * Emit a `<w:drawing>` XML fragment for a picture run. Consumes an
 * `rId` allocated elsewhere (via `ExportContext.allocImageRel`).
 *
 * Inline placement emits `<wp:inline>`. Float placement (a wrapping
 * anchored picture the importer converted to an in-flow CSS float)
 * emits `<wp:anchor>` with a square wrap whose `wrapText` side inverts
 * the float side — text flows opposite the float — plus the float's
 * clearance margins as `dist*`. Re-importing runs the same
 * `floatWrappingImages` conversion and lands back on the identical
 * float run, so the wrap side survives a save → open.
 */
export function renderDrawing(run: DrawingRun, rId: string, docPrId: number): string {
  const cx = run.widthEmu > 0 ? run.widthEmu : 914400; // default 1"
  const cy = run.heightEmu > 0 ? run.heightEmu : 914400;
  const name = `Picture ${docPrId}`;
  const descr = run.altText ?? "";

  const blip = el("a:blip", { "r:embed": rId });
  // `<a:srcRect>` re-emits the source crop (AST fractions → OOXML
  // 1/1000ths of a percent) so a cropped logo round-trips instead of
  // reverting to the full image strip.
  const srcRect = run.srcRect
    ? el("a:srcRect", {
        ...(run.srcRect.l !== undefined ? { l: Math.round(run.srcRect.l * 100000) } : {}),
        ...(run.srcRect.t !== undefined ? { t: Math.round(run.srcRect.t * 100000) } : {}),
        ...(run.srcRect.r !== undefined ? { r: Math.round(run.srcRect.r * 100000) } : {}),
        ...(run.srcRect.b !== undefined ? { b: Math.round(run.srcRect.b * 100000) } : {}),
      })
    : "";
  const blipFill = el(
    "pic:blipFill",
    null,
    `${blip}${srcRect}${el("a:stretch", null, el("a:fillRect"))}`,
  );
  const nvPicPr = el(
    "pic:nvPicPr",
    null,
    `${el("pic:cNvPr", { id: docPrId, name, descr: escapeXmlText(descr) })}${el("pic:cNvPicPr")}`,
  );
  const spPr = el(
    "pic:spPr",
    null,
    `${el("a:xfrm", null, `${el("a:off", { x: 0, y: 0 })}${el("a:ext", { cx, cy })}`)}${el(
      "a:prstGeom",
      { prst: "rect" },
      el("a:avLst"),
    )}`,
  );
  const pic = el("pic:pic", { "xmlns:pic": NS.pic }, `${nvPicPr}${blipFill}${spPr}`);
  const graphicData = el("a:graphicData", { uri: NS.pic }, pic);
  const graphic = el("a:graphic", { "xmlns:a": NS.a }, graphicData);
  const extent = el("wp:extent", { cx, cy });
  const docPr = el("wp:docPr", {
    id: docPrId,
    name,
    descr: escapeXmlText(descr),
  });
  if (run.placement === "floatLeft" || run.placement === "floatRight") {
    const m = run.floatMarginsEmu;
    // Text flows on the side OPPOSITE the float: floatLeft ⇒ text right.
    // `floatSide` inverts this exact mapping on re-import.
    const wrapText = run.placement === "floatLeft" ? "right" : "left";
    const anchor = el(
      "wp:anchor",
      {
        ...(m ? { distT: m.topEmu, distB: m.bottomEmu, distL: m.leftEmu, distR: m.rightEmu } : {}),
        simplePos: 0,
        relativeHeight: 0,
        behindDoc: 0,
        locked: 0,
        layoutInCell: 1,
        allowOverlap: 1,
      },
      [
        el("wp:simplePos", { x: 0, y: 0 }),
        el(
          "wp:positionH",
          { relativeFrom: "column" },
          el("wp:align", null, run.placement === "floatLeft" ? "left" : "right"),
        ),
        el("wp:positionV", { relativeFrom: "paragraph" }, el("wp:posOffset", null, "0")),
        extent,
        el("wp:wrapSquare", { wrapText }),
        docPr,
        graphic,
      ].join(""),
    );
    return el("w:r", null, el("w:drawing", { "xmlns:wp": NS.wp }, anchor));
  }

  const inline = el(
    "wp:inline",
    {
      distT: 0,
      distB: 0,
      distL: 0,
      distR: 0,
    },
    `${extent}${docPr}${graphic}`,
  );
  return el("w:r", null, el("w:drawing", { "xmlns:wp": NS.wp }, inline));
}
