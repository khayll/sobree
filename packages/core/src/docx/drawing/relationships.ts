/**
 * Owns relationship → media-part resolution for drawings: reading
 * `r:embed` off an `<a:blip>`, looking it up in the document's rels map,
 * and normalising the resulting part path. The one place that knows how a
 * drawing points at its image bytes.
 */

import { NS } from "../shared/namespaces";

/**
 * Normalise a relationship target to a `word/…`-rooted part path.
 *   - a package-absolute `/word/media/x.png` drops the leading slash,
 *   - an already-`word/`-rooted path is left as-is,
 *   - a document-relative `media/x.png` is rooted under `word/`.
 */
export function normalizePartPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("word/")) return target;
  return `word/${target}`;
}

/**
 * Resolve an `<a:blip r:embed>` to its normalised media part path, or
 * `null` when the blip has no embed id or the id isn't in `rels`.
 */
export function readBlipEmbedPart(blip: Element, rels: Map<string, string>): string | null {
  const rId = blip.getAttributeNS(NS.r, "embed") ?? blip.getAttribute("r:embed");
  if (!rId) return null;
  const target = rels.get(rId);
  if (!target) return null;
  return normalizePartPath(target);
}
