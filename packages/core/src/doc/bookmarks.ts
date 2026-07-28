/**
 * Bookmark ↔ DOM naming, owned in one place.
 *
 * The MODEL addresses a bookmark by its OOXML name (`_Toc123`, `intro`),
 * and an internal `HyperlinkRun.href` is `#<name>`. The DOM needs a
 * globally-safe element id for the rendered marker, so the renderer
 * prefixes names and the serializer strips the prefix back — both through
 * these helpers, so the mapping cannot drift between the two directions.
 */

const DOM_PREFIX = "sobree-bookmark-";

/** DOM element id for a bookmark's rendered start marker. */
export function bookmarkDomId(name: string): string {
  return `${DOM_PREFIX}${name}`;
}

/**
 * Map a model href to the DOM href the renderer should emit: internal
 * anchors (`#name`) point at the marker's DOM id; everything else
 * passes through untouched.
 */
export function domHrefFor(href: string): string {
  return href.startsWith("#") ? `#${bookmarkDomId(href.slice(1))}` : href;
}

/** Inverse of {@link domHrefFor} for DOM read-back. */
export function modelHrefFrom(href: string): string {
  const p = `#${DOM_PREFIX}`;
  return href.startsWith(p) ? `#${href.slice(p.length)}` : href;
}
