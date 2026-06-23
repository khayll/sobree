import type { BlockRef, HeadlessSobree } from "@sobree/core";

/**
 * Resolve a block id to a BlockRef (with current version) for the
 * editor's optimistic-lock check. Throws a user-facing error if the
 * id doesn't exist — the LLM may have referenced a deleted block.
 */
export function lookupRef(sobree: HeadlessSobree, blockId: string, field: string): BlockRef {
  const info = sobree.getBlockById(blockId);
  if (!info) {
    throw new Error(
      `${field}: block ${JSON.stringify(blockId)} not found. Call get_document to refresh block ids — the document may have changed.`,
    );
  }
  return { id: info.id, version: info.version };
}

/** Format an EditError as a human-readable string for the LLM. */
export function formatEditError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code: string; details?: string; conflicts?: unknown };
    if (e.code === "optimistic-lock") {
      return (
        "optimistic-lock: another peer modified this block between your read and write. " +
        "Call get_document to refresh and try again."
      );
    }
    return `${e.code}${e.details ? `: ${e.details}` : ""}`;
  }
  return String(err);
}
