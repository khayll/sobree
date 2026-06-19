/**
 * Field-instruction helpers.
 *
 * Word writes a field's instruction with optional formatting switches —
 * `PAGE  \* MERGEFORMAT`, `NUMPAGES \* Arabic`, `DATE \@ "d MMM yyyy"`.
 * Code that recognises a field by KIND must look at the first token, not
 * the whole string, or `PAGE \* MERGEFORMAT` silently fails to match
 * `PAGE` (the bug that left footer page numbers stuck on a cached value).
 */

/** The field type — the first whitespace-delimited token, uppercased. */
export function fieldType(instruction: string): string {
  return instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}
