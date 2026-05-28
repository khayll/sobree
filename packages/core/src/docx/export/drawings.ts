import { NS } from "../shared/namespaces";
import { el, escapeXmlText } from "../shared/xml";
import type { DrawingRun } from "../../doc/types";

/**
 * Emit a `<w:drawing>` XML fragment for an inline image. Consumes an
 * `rId` allocated elsewhere (via `ExportContext.allocImageRel`) and
 * writes the OOXML shape Word expects for a single inline picture.
 *
 * Anchored / floating drawings are out of scope for Phase 5 — all images
 * render inline.
 */
export function renderDrawing(run: DrawingRun, rId: string, docPrId: number): string {
  const cx = run.widthEmu > 0 ? run.widthEmu : 914400; // default 1"
  const cy = run.heightEmu > 0 ? run.heightEmu : 914400;
  const name = `Picture ${docPrId}`;
  const descr = run.altText ?? "";

  const blip = el("a:blip", { "r:embed": rId });
  const blipFill = el(
    "pic:blipFill",
    null,
    `${blip}${el("a:stretch", null, el("a:fillRect"))}`,
  );
  const nvPicPr = el(
    "pic:nvPicPr",
    null,
    `${el("pic:cNvPr", { id: docPrId, name, descr: escapeXmlText(descr) })}${el("pic:cNvPicPr")}`,
  );
  const spPr = el(
    "pic:spPr",
    null,
    `${el(
      "a:xfrm",
      null,
      `${el("a:off", { x: 0, y: 0 })}${el("a:ext", { cx, cy })}`,
    )}${el(
      "a:prstGeom",
      { prst: "rect" },
      el("a:avLst"),
    )}`,
  );
  const pic = el(
    "pic:pic",
    { "xmlns:pic": NS.pic },
    `${nvPicPr}${blipFill}${spPr}`,
  );
  const graphicData = el(
    "a:graphicData",
    { uri: NS.pic },
    pic,
  );
  const graphic = el("a:graphic", { "xmlns:a": NS.a }, graphicData);
  const extent = el("wp:extent", { cx, cy });
  const docPr = el("wp:docPr", {
    id: docPrId,
    name,
    descr: escapeXmlText(descr),
  });
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
  return el(
    "w:r",
    null,
    el("w:drawing", { "xmlns:wp": NS.wp }, inline),
  );
}
