/**
 * Constructors for AST nodes. Two reasons these exist as helpers instead
 * of object literals at every call site:
 *   1. Defaults — A4 paper, an empty cell's placeholder paragraph, equal
 *      column widths — without sprinkling magic numbers into caller code.
 *   2. Future schema migration — when a new required field is added, all
 *      construction goes through here and the migration is one diff.
 *
 * Conventions across the layer:
 *   - The factory is named for the node it builds (`text`, `table`,
 *     `tableCell`, `hyperlink`, `sectionBreak`).
 *   - Required content is positional; optional formatting is a trailing
 *     `properties` argument (a leaf's `RunProperties`, a container's
 *     `*Properties`). Many-field nodes (`image`, `table`, `namedStyle`)
 *     take a single trailing options object instead.
 *   - Measurements keep their native OOXML unit, suffixed (`widthEmu`,
 *     `…Twips`), matching the AST.
 *
 * Organised by node category: document / block / inline / table / style.
 */

export {
  appendBlock,
  defaultMargins,
  defaultPageSize,
  defaultSection,
  defaultStyles,
  emptyDocument,
  isParagraph,
  isTable,
  makeHeaderFooterRef,
} from "./document";

export { heading, paragraph, sectionBreak } from "./block";

export {
  columnBreak,
  commentRef,
  emphasis,
  field,
  footnoteRef,
  hyperlink,
  image,
  type ImageOptions,
  pageBreak,
  softBreak,
  strong,
  tab,
  text,
} from "./inline";

export { type CellProperties, type TableOptions, table, tableCell, tableRow } from "./table";

export { type NamedStyleOptions, namedStyle } from "./style";

export {
  type NumberingLevelOptions,
  bulletDefinition,
  numberingDefinition,
  numberingLevel,
  orderedDefinition,
} from "./numbering";
