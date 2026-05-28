/**
 * Collect every `rawParts` ZIP path that's reachable from the
 * document's font declarations. Used by `doc/parts.ts` so the
 * cross-feature liveness walker stays font-agnostic.
 */

import type { SobreeDocument } from "../doc/types";
import type { FontEmbedRef } from "./types";

export function fontLivenessPaths(doc: SobreeDocument): Set<string> {
  const out = new Set<string>();
  for (const f of doc.fonts) {
    if (!f.embed) continue;
    for (const ref of Object.values(f.embed) as Array<FontEmbedRef | undefined>) {
      if (ref?.partPath) out.add(ref.partPath);
    }
  }
  return out;
}
