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

import { NS } from "./namespaces";
import { parseXml } from "./xml";

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
 * Resolve the colour child of `parent` (an `<a:solidFill>` or `<a:ln>`-
 * style container): literal `srgbClr` or theme `schemeClr`, transforms
 * applied. Returns `#RRGGBB` or undefined when no resolvable colour.
 */
export function readDrawingColor(parent: Element, theme?: ThemePalette): string | undefined {
  const srgb = firstA(parent, "srgbClr");
  if (srgb) {
    const val = srgb.getAttribute("val");
    if (!val || !/^[0-9A-Fa-f]{6}$/.test(val)) return undefined;
    return applyTransforms(`#${val.toUpperCase()}`, srgb);
  }
  const scheme = firstA(parent, "schemeClr");
  if (scheme) {
    const slot = mapSchemeSlot(scheme.getAttribute("val"));
    const base = slot && theme ? theme[slot] : undefined;
    if (!base) return undefined;
    return applyTransforms(base, scheme);
  }
  return undefined;
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
  for (const t of Array.from(clrEl.children)) {
    if (t.namespaceURI !== NS.a) continue;
    const val = Number(t.getAttribute("val") ?? "0");
    if (!Number.isFinite(val)) continue;
    switch (t.localName) {
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
  return rgbOut ?? hslToRgb(h, s, l);
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
