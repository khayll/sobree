/**
 * Sobree's internal document model.
 *
 * Every node here maps 1-to-1 to an OOXML construct so serialisation to
 * `.docx` is mechanical (no decisions, no lossy translation). The names
 * are JS-friendly — `Paragraph`, `RunProperties`, etc. — rather than
 * `<w:p>`, `<w:rPr>` directly, but the shapes line up.
 *
 * Conventions:
 *   - All numeric measurements that originate in OOXML keep their native
 *     unit, suffixed in the field name: `wTwips`, `sizeHalfPt`, `widthEmu`.
 *   - All node objects are JSON-clean (no functions, classes, or
 *     references) so they cross any wire (Yjs sync messages, MCP,
 *     postMessage) untouched.
 *   - Optional fields are `?:` — absence means "not set", not "default".
 *     Defaults are applied at render time from the document's styles.
 *
 * The concept modules in this directory each own one slice of the model.
 * This barrel re-exports every AST type so consumers keep importing from
 * `doc/types` regardless of which concept file a type physically lives in.
 */

// Formatting primitives (borders, shading, cell spacing) and the
// table-style conditional-formatting model live in dependency-free leaf
// modules — none reference the recursive `Block` graph, so keeping them
// out of the concept files avoids a circular import. Re-exported so
// consumers keep importing every AST type from `doc/types`.
export type {
  BorderSpec,
  Shading,
  TableBorders,
  TableCellBorders,
  TableCellMargins,
} from "../formatting.types";
export type {
  TableConditionalType,
  TableLook,
  TableStyleCellFormat,
  TableStyleDefinition,
} from "../tableStyle.types";

export type * from "./block";
export type * from "./document";
export type * from "./drawing";
export type * from "./headersFooters";
export type * from "./numbering";
export type * from "./paragraph";
export type * from "./parts";
export type * from "./revisions";
export type * from "./runs";
export type * from "./sections";
export type * from "./styles";
