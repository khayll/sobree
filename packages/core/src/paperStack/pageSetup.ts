export type PageSizeKey = "A3" | "A4" | "A5" | "B5" | "Letter" | "Legal" | "Tabloid";

export interface PageSizeMM {
  width: number;
  height: number;
}

export const PAGE_SIZES: Record<PageSizeKey, PageSizeMM> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B5: { width: 176, height: 250 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Tabloid: { width: 279.4, height: 431.8 },
};

export type Orientation = "portrait" | "landscape";

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageZoneText {
  default: string;
  first: string;
  last: string;
  differentFirst: boolean;
  differentLast: boolean;
}

/** Vertical alignment of body content on every page — OOXML `<w:vAlign>`. */
export type VerticalAlign = "top" | "center" | "bottom" | "both";

export interface PageSetup {
  size: PageSizeKey;
  orientation: Orientation;
  margins: Margins;
  header: PageZoneText;
  footer: PageZoneText;
  /** Section-level vertical alignment. Default `"top"`. */
  verticalAlign: VerticalAlign;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: "A4",
  orientation: "portrait",
  margins: { top: 25, right: 20, bottom: 25, left: 20 },
  header: {
    default: "",
    first: "",
    last: "",
    differentFirst: false,
    differentLast: false,
  },
  footer: {
    default: "Page {page} of {pages}",
    first: "",
    last: "",
    differentFirst: false,
    differentLast: false,
  },
  verticalAlign: "top",
};

export function resolvedDimensions(setup: PageSetup): { widthMM: number; heightMM: number } {
  const { width, height } = PAGE_SIZES[setup.size];
  return setup.orientation === "landscape"
    ? { widthMM: height, heightMM: width }
    : { widthMM: width, heightMM: height };
}

export function substituteVariables(
  template: string,
  ctx: { page: number; pages: number },
): string {
  return template.replace(/\{page\}/g, String(ctx.page)).replace(/\{pages\}/g, String(ctx.pages));
}

/** Pick the raw zone template for a given page, honouring first/last overrides. */
export function zoneTemplateFor(zone: PageZoneText, page: number, pages: number): string {
  if (page === 1 && zone.differentFirst) return zone.first;
  if (page === pages && zone.differentLast && pages > 1) return zone.last;
  return zone.default;
}
