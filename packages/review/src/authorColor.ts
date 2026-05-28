/**
 * Hash an author name to one of 8 palette *slots*, returning a CSS
 * value that references the matching `@sobree/core` design token.
 * Same author → same slot across the document.
 *
 * Returns `var(--sobree-author-N, #hex)` — a token reference with a
 * hard-coded hex fallback, so it works with or without
 * `@sobree/core/tokens.css` loaded, and consumers can re-theme any
 * slot by overriding `--sobree-author-N`.
 *
 * (Moved out of `@sobree/core` when the review display became a
 * plugin — core keeps only the neutral semantic marks.)
 */

const FALLBACK_PALETTE = [
  "#1f77b4", // 0 muted blue
  "#2ca02c", // 1 green
  "#9467bd", // 2 purple
  "#8c564b", // 3 brown
  "#e377c2", // 4 pink
  "#17becf", // 5 teal
  "#bcbd22", // 6 olive
  "#ff7f0e", // 7 orange
];

/** Hash `author` to a palette slot index 0..7. Deterministic. */
export function authorSlot(author: string | undefined): number {
  if (!author) return 0;
  let h = 2166136261;
  for (let i = 0; i < author.length; i++) {
    h ^= author.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % FALLBACK_PALETTE.length;
}

/** CSS colour value for `author` — a `var(--sobree-author-N, #hex)` ref. */
export function colorForAuthor(author: string | undefined): string {
  const slot = authorSlot(author);
  return `var(--sobree-author-${slot}, ${FALLBACK_PALETTE[slot]})`;
}
