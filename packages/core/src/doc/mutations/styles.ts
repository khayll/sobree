// Named-style CRUD mutations.

import type { NamedStylePatch } from "../../editor/types";
import { fail } from "../api";
import type { NamedStyle } from "../types";
import { type DocumentMutationResult, type MutationInput, okPatch } from "./types";

/** Merge a {@link NamedStylePatch} onto an existing style. Each present
 *  field replaces the style's field wholesale; an explicit `undefined`
 *  clears an OPTIONAL field. The required `type` / `displayName` are never
 *  cleared (an undefined for them is ignored). */
export function mergeNamedStyle(prev: NamedStyle, patch: NamedStylePatch): NamedStyle {
  const out = { ...prev } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      if (k !== "type" && k !== "displayName") delete out[k];
    } else {
      out[k] = v;
    }
  }
  return out as unknown as NamedStyle;
}

/** Add a new named style. Fails if `style.id` already exists. */
export function defineStyleMutation(
  input: MutationInput,
  style: NamedStyle,
): DocumentMutationResult<void> {
  if (input.doc.styles.some((s) => s.id === style.id)) {
    return fail({ code: "invalid-state", details: `style "${style.id}" already exists` });
  }
  return okPatch({ styles: [...input.doc.styles, style] }, []);
}

/** Merge a patch into the style with `id`. Fails if no such style. */
export function updateStyleMutation(
  input: MutationInput,
  id: string,
  patch: NamedStylePatch,
): DocumentMutationResult<void> {
  const styles = input.doc.styles;
  const index = styles.findIndex((s) => s.id === id);
  if (index < 0) return fail({ code: "invalid-state", details: `no style "${id}"` });
  const next = styles.slice();
  // biome-ignore lint/style/noNonNullAssertion: index came from findIndex.
  next[index] = mergeNamedStyle(styles[index]!, patch);
  return okPatch({ styles: next }, []);
}

/** Remove the style with `id`. Fails if no such style. */
export function removeStyleMutation(
  input: MutationInput,
  id: string,
): DocumentMutationResult<void> {
  if (!input.doc.styles.some((s) => s.id === id)) {
    return fail({ code: "invalid-state", details: `no style "${id}"` });
  }
  return okPatch({ styles: input.doc.styles.filter((s) => s.id !== id) }, []);
}
