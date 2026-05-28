# `src/pagination`

A greedy, single-pass page-breaking paginator modeled after TeX's output
routine and the CSS Fragmentation Module. Pure function, no DOM, no I/O.

```ts
import { paginate } from "@sobree/core";

const pages = paginate(items, { pageHeight: 720 });
```

## Concerns, kept separate

- **Stream walking** — `paginate.ts`. Walks the item list, accumulates a
  page's height and a list of candidate break positions, and decides when to
  emit a page.
- **Candidate scoring** — `cost.ts`. Pure functions that score a candidate
  break and compute the widow/orphan, keep-with-next and keep-together
  penalties.
- **Post-conditions** — `postConditions.ts`. The back-off-by-one-line rule
  applied after picking a best candidate, so widow/orphan violations get
  resolved by pulling a line to the next page rather than splitting badly.

## Cost model

At a candidate break position `pos`:

```
leftover    = pageHeight − heightAt(pos)
underfull   = underfullWeight × leftover²
ownCost     = penalty cost at pos (0 for a glue break)
widowOrphan = widowOrphanPenalty if the break violates min-lines rules
keepNext    = +Infinity if pos is a break after a keepWithNext paragraph
keepTogether= keepPenalty if pos is inside a keepTogether paragraph

totalCost   = underfull + ownCost + widowOrphan + keepNext + keepTogether
```

Lower is better. The paginator picks the candidate with the lowest
`totalCost` among candidates on the current page. If the chosen break still
violates widow/orphan, the post-condition walks backward through the
candidate list and picks the nearest earlier break that doesn't violate.

## Candidate positions

A position is a candidate iff it is either:

- a **penalty item** with finite cost (including `0`) or `−Infinity`
  (forced); or
- a **glue item between two boxes**, unless the glue sits inside a
  `keepTogether` paragraph (both flanking boxes share a `paragraphId` of a
  paragraph marked `keepTogether`).

`+Infinity` penalties are skipped — the break there is forbidden.

## Forced, monolithic, oversized

- A `−Infinity` penalty breaks the page immediately at that position. The
  penalty item is consumed (it doesn't appear on either page).
- A `monolithic` box that doesn't fit in the remaining space forces a break
  before it.
- A box taller than `pageHeight` is placed alone on its own page and the page
  is allowed to overflow (with a `console.warn`).

## Keep-together

If the first line of a paragraph marked `keepTogether` is reached and the
whole paragraph doesn't fit in the remaining space, the paginator breaks
before that paragraph and starts it on the next page. If the paragraph
doesn't fit on a full page either, the paginator warns and falls back to
normal breaking (the paragraph will be split at the best candidates it
contains).

## Trailing glue

On each emitted page, trailing glue (glue after the last box on the page) is
retained in the `items` array for round-tripping but is **excluded from
`usedHeight`**. Penalty items never contribute height.

## Simplifications (vs. TeX)

This is a greedy one-pass algorithm — it doesn't do TeX's
break-of-best-breaks search across an entire chapter. It's linear in the
common case: each item is visited once; per-page candidate evaluation
is `O(K²)` where `K` is the number of candidates on that page (candidate
scoring walks nearby boxes for widow/orphan checks). Overall: `O(N)`
expected, `O(N · K)` worst case.

Other simplifications:

- Box height is the only vertical metric; there is no shrink/stretch on
  glue.
- No line-breaking happens here. Lines are assumed pre-computed by the
  caller and delivered as boxes.
- No column balancing, no footnotes, no figure placement.

## Keep-with-next

`+Infinity` is used for the keep-with-next penalty. That makes the break
forbidden in scoring so long as *any* other candidate exists; otherwise the
algorithm falls back through `pickAndEmit`'s no-candidates path.

## Reference-sized tests

The module ships with 8 tests in `paginate.test.ts` covering: uniform fill,
orphan prevention, widow prevention, keep-with-next, forced break,
monolithic overflow, trailing glue discard, and keep-together.
