import { ptToHalfPt } from "../shared/units";
import { NS } from "../shared/namespaces";
import { el, xmlDocument } from "../shared/xml";
import type { NamedStyle, RunProperties } from "../../doc/types";

/**
 * Render the document's named styles into `word/styles.xml`. Word needs a
 * style-definition entry for every `w:pStyle` referenced in the body.
 * Missing entries make Word fall back to Normal, stripping the visual
 * hierarchy.
 */
export function renderStylesXml(styles: readonly NamedStyle[]): string {
  const children: string[] = [];

  // Document-wide defaults.
  children.push(
    el(
      "w:docDefaults",
      null,
      [el("w:rPrDefault", null, el("w:rPr", null, "")), el("w:pPrDefault", null, el("w:pPr", null, ""))],
    ),
  );

  const hasNormal = styles.some((s) => s.id === "Normal");
  if (!hasNormal) {
    children.push(styleElement({ id: "Normal", type: "paragraph", displayName: "Normal" }, true));
  }

  for (const style of styles) {
    children.push(styleElement(style, style.id === "Normal"));
  }

  return xmlDocument(el("w:styles", { "xmlns:w": NS.w }, children));
}

function styleElement(style: NamedStyle, isDefault: boolean): string {
  const attrs: Record<string, string> = {
    "w:type": style.type,
    "w:styleId": style.id,
  };
  if (isDefault) attrs["w:default"] = "1";

  const body: string[] = [el("w:name", { "w:val": style.displayName })];
  if (!isDefault && style.basedOn) body.push(el("w:basedOn", { "w:val": style.basedOn }));
  if (style.nextStyleId) body.push(el("w:next", { "w:val": style.nextStyleId }));
  if (style.runDefaults) {
    const rPr = runPropertiesToXml(style.runDefaults);
    if (rPr) body.push(rPr);
  }

  return el("w:style", attrs, body);
}

function runPropertiesToXml(props: RunProperties): string {
  const parts: string[] = [];
  if (props.bold) parts.push(el("w:b"));
  if (props.italic) parts.push(el("w:i"));
  if (props.strike) parts.push(el("w:strike"));
  if (props.underline && props.underline !== "none") {
    parts.push(el("w:u", { "w:val": props.underline }));
  }
  if (props.color) parts.push(el("w:color", { "w:val": props.color.replace(/^#/, "") }));
  if (props.fontFamily) {
    parts.push(
      el("w:rFonts", {
        "w:ascii": props.fontFamily,
        "w:hAnsi": props.fontFamily,
        "w:cs": props.fontFamily,
      }),
    );
  }
  if (props.fontSizePt) {
    const hp = ptToHalfPt(props.fontSizePt);
    parts.push(el("w:sz", { "w:val": hp }));
    parts.push(el("w:szCs", { "w:val": hp }));
  }
  return parts.length > 0 ? el("w:rPr", null, parts) : "";
}
