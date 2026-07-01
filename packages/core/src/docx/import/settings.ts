/**
 * Parse the subset of `word/settings.xml` that affects rendering.
 *
 * The two flags we care about right now are the ones that decide
 * whether Word applies its implicit "Word 2010+ Normal style" baseline
 * (line ≈ 1.08, after = 8pt) at render time even when styles.xml
 * leaves Normal empty:
 *
 *   - `<w:compatibilityMode w:val="14"/>` — Word's rendering era.
 *      12+ = Word 2007+ with the modern Normal defaults.
 *      <12 = legacy mode, no implicit spacing.
 *   - `<w:doNotUseHTMLParagraphAutoSpacing/>` — when present, Word
 *      explicitly opts out of the modern auto-spacing and renders
 *      tight regardless of compatibilityMode.
 *
 * This is the missing piece that explains why a Word-authored docx
 * with an empty `<w:style w:styleId="Normal">` renders with visible
 * inter-paragraph breathing in Word (compatibilityMode 14, auto-
 * spacing on), but a programmatically-generated docx with no
 * `<w:compatibilityMode>` renders tight in Word too. Without this
 * gate, Sobree's baseline-injection either over- or under-applies
 * depending on the source.
 */

import { NS } from "../shared/namespaces";
import { parseXml, wAll, wFirst } from "../shared/xml";

export interface DocSettings {
  /** Numeric compatibility mode from `<w:compatibilityMode>`. Undefined
   *  if the docx omits it (treat as legacy = pre-Word-2007). */
  compatibilityMode?: number;
  /** True when `<w:doNotUseHTMLParagraphAutoSpacing/>` is present. */
  doNotUseHTMLParagraphAutoSpacing: boolean;
  /** `<w:defaultTabStop w:val="N"/>` in twips. Used as the interval
   *  for tab advances in paragraphs that don't declare their own
   *  `<w:tabs>`. Word's factory default is 720 twips (0.5"). */
  defaultTabStopTwips?: number;
  /** `<w:compat><w:noColumnBalance/>` — disable column balancing at
   *  continuous section breaks document-wide (columns fill column-first
   *  instead of equalising on the last page). */
  noColumnBalance?: boolean;
  /** `<w:displayBackgroundShape/>` — Word's gate for painting the
   *  document `<w:background>` (page colour / background shape) in print
   *  layout. Absent ⇒ the background stays hidden on the printed page. */
  displayBackgroundShape: boolean;
}

export function parseSettingsXml(xml: string | undefined): DocSettings {
  const out: DocSettings = {
    doNotUseHTMLParagraphAutoSpacing: false,
    displayBackgroundShape: false,
  };
  if (!xml) return out;
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return out;
  }

  // <w:compat>/<w:compatSetting w:name="compatibilityMode" w:val="14"/>
  // is the modern format. Older docs may have a bare
  // <w:compatibilityMode> element directly under <w:compat>.
  for (const el of wAll(doc, "compatSetting")) {
    const name = el.getAttributeNS(NS.w, "name") ?? el.getAttribute("w:name");
    if (name !== "compatibilityMode") continue;
    const val = el.getAttributeNS(NS.w, "val") ?? el.getAttribute("w:val");
    if (val) {
      const n = Number.parseInt(val, 10);
      if (Number.isFinite(n)) out.compatibilityMode = n;
    }
  }
  if (out.compatibilityMode === undefined) {
    const legacy = wFirst(doc, "compatibilityMode");
    if (legacy) {
      const val = legacy.getAttributeNS(NS.w, "val") ?? legacy.getAttribute("w:val");
      if (val) {
        const n = Number.parseInt(val, 10);
        if (Number.isFinite(n)) out.compatibilityMode = n;
      }
    }
  }

  // <w:doNotUseHTMLParagraphAutoSpacing/> — boolean flag (presence = on).
  if (wFirst(doc, "doNotUseHTMLParagraphAutoSpacing")) {
    out.doNotUseHTMLParagraphAutoSpacing = true;
  }

  // <w:noColumnBalance/> — disable column balancing at continuous breaks.
  if (wFirst(doc, "noColumnBalance")) out.noColumnBalance = true;

  // <w:displayBackgroundShape/> — show the document background in print
  // layout (Word sets this whenever a page colour is applied).
  if (wFirst(doc, "displayBackgroundShape")) out.displayBackgroundShape = true;

  // <w:defaultTabStop w:val="720"/> — interval for tab advances when a
  // paragraph has no explicit `<w:tabs>` stops. Word's factory default
  // is 720 twips (0.5"). Without it, browsers fall back to CSS tab-size
  // default of 8 characters which is much narrower than Word's tab
  // (jellap.docx's header tabs come out ~3x too tight).
  const defaultTabStop = wFirst(doc, "defaultTabStop");
  if (defaultTabStop) {
    const val = defaultTabStop.getAttributeNS(NS.w, "val") ?? defaultTabStop.getAttribute("w:val");
    if (val) {
      const n = Number.parseInt(val, 10);
      if (Number.isFinite(n) && n > 0) out.defaultTabStopTwips = n;
    }
  }

  return out;
}

/**
 * Should we apply Word's implicit "Normal style" paragraph baseline
 * (line ≈ 1.08, after = 8pt) for paragraphs whose explicit settings
 * leave those fields undefined?
 *
 * Word's rule, distilled: yes when in Word 2007+ rendering mode
 * (compatibilityMode >= 12) AND auto-spacing isn't explicitly turned
 * off. Without this gate, Sobree either over-applies (on a docx-
 * library-style doc that lacks compatibilityMode → renders tight in
 * Word too) or under-applies (on a Word-authored doc whose Normal
 * style is empty → Word fills in defaults, we don't).
 */
export function shouldApplyAutoSpacing(settings: DocSettings): boolean {
  if (settings.doNotUseHTMLParagraphAutoSpacing) return false;
  if (settings.compatibilityMode === undefined) return false;
  return settings.compatibilityMode >= 12;
}
