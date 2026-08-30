/**
 * DrawingML colour resolution — literal AND theme colours.
 *
 * A DrawingML colour container (`<a:solidFill>`, the children of
 * `<a:ln>`, …) holds either a literal `<a:srgbClr val="RRGGBB">` or a
 * theme reference `<a:schemeClr val="accent1">`. Both can carry child
 * TRANSFORM elements that adjust the base colour (`hueOff`, `satOff`,
 * `lumOff`, `lumMod`, `shade`, `tint`, …). Word resolves the scheme slot
 * against `word/theme/theme1.xml`'s `<a:clrScheme>` and applies the
 * transforms in document order — reading only `srgbClr` renders every
 * theme-coloured shape invisible (no fill, no stroke).
 *
 * Transform units (ECMA-376 §20.1.2.3):
 *   - `hueOff`  — 60000ths of a degree, added to the hue.
 *   - `satOff` / `lumOff` — 1000ths of a percent-POINT, added to S / L.
 *   - `satMod` / `lumMod` — 100000ths, multiplied onto S / L.
 *   - `shade` — scale toward black (val/100000).
 *   - `tint`  — scale toward white (val/100000).
 */

import { NS } from "../shared/namespaces";
import { parseXml } from "../shared/xml";

/** Theme slot → `#RRGGBB`. Slots: dk1/lt1/dk2/lt2/accent1-6/hlink/folHlink. */
export type ThemePalette = Record<string, string>;

/** Parse `word/theme/theme1.xml` into the colour-scheme palette.
 *  Returns undefined when the part is absent or malformed. */
export function parseThemeXml(xml: string | undefined): ThemePalette | undefined {
  if (!xml) return undefined;
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return undefined;
  }
  const scheme = doc.getElementsByTagNameNS(NS.a, "clrScheme")[0];
  if (!scheme) return undefined;
  const palette: ThemePalette = {};
  for (const slot of Array.from(scheme.children)) {
    if (slot.namespaceURI !== NS.a) continue;
    const srgb = firstA(slot, "srgbClr");
    const sys = firstA(slot, "sysClr");
    const val = srgb?.getAttribute("val") ?? sys?.getAttribute("lastClr");
    if (val && /^[0-9A-Fa-f]{6}$/.test(val)) palette[slot.localName] = `#${val.toUpperCase()}`;
  }
  return Object.keys(palette).length > 0 ? palette : undefined;
}

/**
 * Parse the theme's `<a:fmtScheme><a:lnStyleLst>` outline widths (EMU), in
 * order. A shape's `<a:lnRef idx="N">` references the Nth (1-based) entry
 * for its outline WIDTH, while the lnRef's own colour child gives the
 * stroke colour. Empty when the theme omits the list.
 */
/**
 * `<a:fontScheme>` — the theme's major (heading) and minor (body) Latin
 * typefaces. What `w:asciiTheme="majorHAnsi"` etc. resolve against, and
 * the source of truth the styles baseline previously hardcoded as
 * "Calibri Light" / "Calibri" (the Office-default theme's faces).
 */
export function parseThemeFontScheme(
  xml: string | undefined,
): { major?: string; minor?: string } | undefined {
  if (!xml) return undefined;
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return undefined;
  }
  const read = (slot: "majorFont" | "minorFont"): string | undefined => {
    const el = doc.getElementsByTagNameNS(NS.a, slot)[0];
    const latin = el ? Array.from(el.children).find((c) => c.localName === "latin") : undefined;
    const face = latin?.getAttribute("typeface")?.trim();
    return face ? face : undefined;
  };
  const major = read("majorFont");
  const minor = read("minorFont");
  if (major === undefined && minor === undefined) return undefined;
  return { ...(major ? { major } : {}), ...(minor ? { minor } : {}) };
}

export function parseThemeLineWidthsEmu(xml: string | undefined): number[] {
  if (!xml) return [];
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return [];
  }
  const lst = doc.getElementsByTagNameNS(NS.a, "lnStyleLst")[0];
  if (!lst) return [];
  const widths: number[] = [];
  for (const ln of Array.from(lst.children)) {
    if (ln.namespaceURI !== NS.a || ln.localName !== "ln") continue;
    const w = Number.parseInt(ln.getAttribute("w") ?? "", 10);
    widths.push(Number.isFinite(w) ? w : 0);
  }
  return widths;
}

/**
 * Resolve the colour child of `parent` (an `<a:solidFill>` or `<a:ln>`-
 * style container): literal `srgbClr` or theme `schemeClr`, transforms
 * applied. Returns `#RRGGBB` or undefined when no resolvable colour.
 */
export function readDrawingColor(
  parent: Element,
  theme?: ThemePalette,
  phClr?: string,
): string | undefined {
  const srgb = firstA(parent, "srgbClr");
  if (srgb) {
    const val = srgb.getAttribute("val");
    if (!val || !/^[0-9A-Fa-f]{6}$/.test(val)) return undefined;
    return applyTransforms(`#${val.toUpperCase()}`, srgb);
  }
  const scheme = firstA(parent, "schemeClr");
  if (scheme) {
    const slotVal = scheme.getAttribute("val");
    // `phClr` is the style-list PLACEHOLDER colour (§20.1.4.1.14): a
    // theme fill/line style entry is a template, and the shape's
    // `<a:*Ref>` colour child substitutes in at resolution time.
    const base =
      slotVal === "phClr"
        ? phClr
        : (() => {
            const slot = mapSchemeSlot(slotVal);
            return slot && theme ? theme[slot] : undefined;
          })();
    if (!base) return undefined;
    return applyTransforms(base, scheme);
  }
  return undefined;
}

/**
 * The theme's `<a:fmtScheme>` fill style lists, kept as raw elements —
 * resolved per shape at import time (each shape substitutes its own
 * `phClr`). `fill` = `<a:fillStyleLst>` (fillRef idx 1-999, 1-based);
 * `bg` = `<a:bgFillStyleLst>` (fillRef idx ≥1001, idx-1000 is 1-based).
 */
export interface ThemeFillStyles {
  fill: Element[];
  bg: Element[];
  /** Mean LUMINANCE (0–1, Rec. 601) of each `<a:blipFill>` entry's
   *  texture image, keyed by the entry element. Computed once at
   *  import by {@link computeThemeBlipLuminance} (async — needs image
   *  decode); absent in environments without canvas (unit tests),
   *  where the duotone falls back to its endpoint midpoint. */
  blipAvgLum?: Map<Element, number>;
}

/**
 * Decode each theme `<a:blipFill>` texture and record its mean
 * luminance so {@link resolveThemeFillEntry} can compute the EXACT
 * average colour of the duotoned texture — `c1·(1−lum) + c2·lum` per
 * channel is the linear duotone's true mean, no guessed weights. A
 * paper-grain texture is mostly light, so the midpoint fallback
 * renders a page-frame ring visibly darker/heavier than Word.
 *
 * Sampling: the bitmap is drawn at most 64×64 — a tiled grain
 * texture's mean converges long before that. Every failure (no
 * canvas, undecodable image, missing part) just leaves the entry
 * un-annotated.
 */
export async function computeThemeBlipLuminance(
  styles: ThemeFillStyles,
  themeRelsXml: string | undefined,
  binaryParts: Record<string, Uint8Array>,
): Promise<void> {
  if (!themeRelsXml || typeof createImageBitmap !== "function") return;
  const rels = new Map<string, string>();
  try {
    const doc = parseXml(themeRelsXml);
    for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) rels.set(id, target);
    }
  } catch {
    return;
  }
  const avg = new Map<Element, number>();
  for (const entry of [...styles.fill, ...styles.bg]) {
    if (entry.localName !== "blipFill") continue;
    const blip = entry.getElementsByTagNameNS(NS.a, "blip")[0];
    const relId = blip?.getAttributeNS(NS.r, "embed") ?? blip?.getAttribute("r:embed");
    const target = relId ? rels.get(relId) : undefined;
    if (!target) continue;
    // Targets are relative to word/theme/ — `../media/x` → `word/media/x`.
    const path = target.startsWith("../") ? `word/${target.slice(3)}` : `word/theme/${target}`;
    const bytes = binaryParts[path];
    if (!bytes) continue;
    try {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const w = Math.max(1, Math.min(64, bitmap.width));
      const h = Math.max(1, Math.min(64, bitmap.height));
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement("canvas"), { width: w, height: h });
      const ctx2d = canvas.getContext("2d") as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (!ctx2d) continue;
      ctx2d.drawImage(bitmap, 0, 0, w, h);
      const data = ctx2d.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Linear-light luminance (γ≈2.2 decode, Rec.601 weights) — the
        // duotone's tone mapping operates on light, not on the encoded
        // bytes; averaging encoded values overweights the shadows and
        // rendered the ring visibly darker than Word/LO.
        sum +=
          0.299 * ((data[i] as number) / 255) ** 2.2 +
          0.587 * ((data[i + 1] as number) / 255) ** 2.2 +
          0.114 * ((data[i + 2] as number) / 255) ** 2.2;
      }
      avg.set(entry, sum / (data.length / 4));
    } catch {
      // Undecodable image — leave the entry to the midpoint fallback.
    }
  }
  if (avg.size > 0) styles.blipAvgLum = avg;
}

export function parseThemeFillStyles(xml: string | undefined): ThemeFillStyles | undefined {
  if (!xml) return undefined;
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return undefined;
  }
  const list = (name: string): Element[] => {
    const lst = doc.getElementsByTagNameNS(NS.a, name)[0];
    return lst ? Array.from(lst.children).filter((c) => c.namespaceURI === NS.a) : [];
  };
  const fill = list("fillStyleLst");
  const bg = list("bgFillStyleLst");
  if (fill.length === 0 && bg.length === 0) return undefined;
  return { fill, bg };
}

/**
 * Resolve one theme fill-style entry against a shape's placeholder
 * colour. Returns a CSS background value:
 *
 *   - `<a:solidFill>`  → `#RRGGBB` (phClr substituted, transforms applied)
 *   - `<a:gradFill>`   → `linear-gradient(...)` over the resolved stops
 *                        (`<a:lin ang>` is 1/60000-degree clockwise from
 *                        3 o'clock; CSS 0deg points up, so css = ooxml/60000
 *                        + 90). Path gradients approximate as linear —
 *                        the stop colours dominate the visual.
 *   - `<a:blipFill>` + duotone → the MIDPOINT of the two duotone
 *                        endpoint colours as a solid. The texture image
 *                        itself lives in the theme part and tiles at
 *                        ~paper-grain scale; its duotone endpoints bound
 *                        every pixel, so the midpoint is the flat colour
 *                        the eye averages it to (a CV theme's page frame
 *                        reads as exactly this light grey ring).
 *
 * `undefined` when the entry can't be resolved (unknown kind, no colours).
 */
export function resolveThemeFillEntry(
  entry: Element,
  theme: ThemePalette | undefined,
  phClr: string,
  /** Measured mean luminance of the entry's texture (see
   *  {@link computeThemeBlipLuminance}); midpoint fallback when absent. */
  blipAvgLum?: number,
): string | undefined {
  if (entry.localName === "solidFill") {
    return readDrawingColor(entry, theme, phClr);
  }
  if (entry.localName === "gradFill") {
    const stops: { pos: number; color: string }[] = [];
    const gsLst = firstA(entry, "gsLst");
    for (const gs of gsLst ? Array.from(gsLst.children) : []) {
      if (gs.namespaceURI !== NS.a || gs.localName !== "gs") continue;
      const pos = Number(gs.getAttribute("pos") ?? "0") / 100000;
      const color = readDrawingColor(gs, theme, phClr);
      if (color) stops.push({ pos, color });
    }
    if (stops.length < 2) return stops[0]?.color;
    stops.sort((a, b) => a.pos - b.pos);
    const lin = firstA(entry, "lin");
    const ang = Number(lin?.getAttribute("ang") ?? "5400000");
    const cssDeg = (Number.isFinite(ang) ? ang / 60000 : 90) + 90;
    const stopList = stops.map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(", ");
    return `linear-gradient(${Math.round(cssDeg)}deg, ${stopList})`;
  }
  if (entry.localName === "blipFill") {
    const duotone = entry.getElementsByTagNameNS(NS.a, "duotone")[0];
    if (!duotone) return undefined;
    const ends: string[] = [];
    for (const clr of Array.from(duotone.children)) {
      if (clr.namespaceURI !== NS.a) continue;
      // Wrap so readDrawingColor sees the clr as the single colour child.
      const holder = duotone.ownerDocument.createElementNS(NS.a, "a:holder");
      holder.appendChild(clr.cloneNode(true));
      const c = readDrawingColor(holder, theme, phClr);
      if (c) ends.push(c);
    }
    if (ends.length === 0) return undefined;
    if (ends.length === 1) return ends[0];
    // A duotone tone-maps pixel luminance onto the two endpoint
    // colours — SHADOWS take the darker endpoint, HIGHLIGHTS the
    // lighter, regardless of listing order (Word's own theme bg styles
    // list the tint endpoint first yet render highlights light; keying
    // on the spec's element order inverted the photo). The texture's
    // TRUE average colour is therefore dark·(1−L) + light·L at the
    // image's mean linear luminance. Without the measured mean (no
    // canvas in the environment) the midpoint stands in.
    const [a, b] = ends as [string, string];
    const darkFirst = relativeLuma(a) <= relativeLuma(b);
    const dark = darkFirst ? a : b;
    const light = darkFirst ? b : a;
    return mixHex(dark, light, blipAvgLum ?? 0.5);
  }
  return undefined;
}

/** Encoded-domain Rec.601 luma of a `#RRGGBB` colour (ordering only). */
function relativeLuma(hex: string): number {
  if (!hex.startsWith("#")) return 0;
  const [r, g, b] = hexChannels(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Channel-wise blend of two `#RRGGBB` colours at fraction `t` of the
 *  way from `a` to `b`. Non-hex inputs (rgba endpoints) return `a`. */
function mixHex(a: string, b: string, t: number): string {
  if (!a.startsWith("#") || !b.startsWith("#")) return a;
  const ca = hexChannels(a);
  const cb = hexChannels(b);
  const mix = (i: 0 | 1 | 2): number => Math.round(ca[i] * (1 - t) + cb[i] * t);
  return channelsToHex(mix(0), mix(1), mix(2));
}

/** `tx1/bg1/tx2/bg2` are the wp-level aliases of the theme's dk/lt slots. */
function mapSchemeSlot(val: string | null): string | null {
  switch (val) {
    case "tx1":
      return "dk1";
    case "bg1":
      return "lt1";
    case "tx2":
      return "dk2";
    case "bg2":
      return "lt2";
    default:
      return val;
  }
}

function applyTransforms(hex: string, clrEl: Element): string {
  let [h, s, l] = rgbToHsl(hex);
  let rgbOut: string | null = null;
  let alpha: number | undefined;
  for (const t of Array.from(clrEl.children)) {
    if (t.namespaceURI !== NS.a) continue;
    const val = Number(t.getAttribute("val") ?? "0");
    if (!Number.isFinite(val)) continue;
    switch (t.localName) {
      case "alpha":
        // `<a:alpha val="83000"/>` = 83% opacity. Semi-transparent
        // fills are how layered page designs make their middle band:
        // an 83%-white rectangle over a grey texture reads as the
        // LIGHTER grey frame inset in the darker ring. Dropping the
        // alpha painted it opaque and erased the band.
        alpha = clamp01(val / 100000);
        break;
      case "hueOff":
        h = (((h + val / 60000) % 360) + 360) % 360;
        break;
      case "satOff":
        s = clamp01(s + val / 100000);
        break;
      case "lumOff":
        l = clamp01(l + val / 100000);
        break;
      case "satMod":
        s = clamp01((s * val) / 100000);
        break;
      case "lumMod":
        l = clamp01((l * val) / 100000);
        break;
      case "shade": {
        const f = val / 100000;
        rgbOut = scaleRgb(rgbOut ?? hslToRgb(h, s, l), f, 0);
        break;
      }
      case "tint": {
        const f = val / 100000;
        rgbOut = scaleRgb(rgbOut ?? hslToRgb(h, s, l), f, 255);
        break;
      }
      default:
        break;
    }
  }
  const out = rgbOut ?? hslToRgb(h, s, l);
  if (alpha === undefined || alpha >= 1) return out;
  const [r, g, b] = hexChannels(out);
  // rgba() is a valid CSS color everywhere fills/strokes land
  // (style.background / style.border), so alpha rides the same string.
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Scale each channel toward `toward` (0 = black for shade, 255 = white
 *  for tint) keeping `f` of the original. */
function scaleRgb(hex: string, f: number, toward: 0 | 255): string {
  const [r, g, b] = hexChannels(hex);
  const mix = (c: number): number => Math.round(c * f + toward * (1 - f));
  return channelsToHex(mix(r), mix(g), mix(b));
}

function hexChannels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function channelsToHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0").toUpperCase();
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** → [hue 0-360, sat 0-1, lum 0-1] */
function rgbToHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexChannels(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): string {
  if (s === 0) {
    const v = Math.round(l * 255);
    return channelsToHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hh = h / 360;
  return channelsToHex(
    Math.round(channel(hh + 1 / 3) * 255),
    Math.round(channel(hh) * 255),
    Math.round(channel(hh - 1 / 3) * 255),
  );
}

function firstA(parent: Element, local: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === NS.a && child.localName === local) return child;
  }
  return null;
}
