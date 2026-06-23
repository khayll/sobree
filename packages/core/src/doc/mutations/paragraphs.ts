// Paragraph-property mutations.

import type { ParagraphPropertiesPatch } from "../../editor/types";
import { type BlockRef, fail } from "../api";
import type { ParagraphProperties } from "../types";
import {
  type DocumentMutationResult,
  type Mutation,
  type MutationInput,
  checkRefs,
  okPatch,
} from "./types";

/**
 * Merge a `ParagraphPropertiesPatch` into existing properties.
 * `undefined` in the patch removes a field; everything else
 * overwrites.
 */
export function mergeParagraphProps(
  prev: ParagraphProperties,
  patch: ParagraphPropertiesPatch,
): ParagraphProperties {
  const out: ParagraphProperties = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (out as Record<string, unknown>)[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Merge a patch into each target paragraph's properties. Bumps each
 *  paragraph's version; fails if any target is not a paragraph. */
export function applyBlockPropertiesMutation(
  input: MutationInput,
  targets: readonly BlockRef[],
  patch: ParagraphPropertiesPatch,
): DocumentMutationResult<void> {
  const lock = checkRefs(input.registry, targets);
  if (lock) return lock;
  const next = input.doc.body.slice();
  const bumps: Mutation[] = [];
  for (const ref of targets) {
    const index = input.registry.indexOf(ref.id);
    const block = next[index];
    if (!block) continue;
    if (block.kind !== "paragraph") {
      return fail({
        code: "invalid-state",
        details: `block ${ref.id} is not a paragraph`,
      });
    }
    next[index] = { ...block, properties: mergeParagraphProps(block.properties, patch) };
    bumps.push({ type: "bump", index });
  }
  return okPatch({ body: next }, bumps);
}
