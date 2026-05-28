/**
 * Y.Doc backing for Sobree.
 *
 * The document is a Y.Doc; `SobreeDocument` is a *projection* computed
 * by `projectYDoc` and cached by the Editor. All mutations go through
 * `applyDocumentToYDoc` which diffs against the current Y state by
 * block id and (for paragraphs) by Y.Text content.
 *
 * See `./schema.ts` for the Y.Doc layout, `./runs.ts` for the
 * Run↔Delta mapping, and `./textDiff.ts` for the smart Y.Text diff
 * that preserves CRDT semantics across applies.
 */

export {
  Y_BLOCK_AST_KEY,
  Y_BLOCK_ID_KEY,
  Y_BLOCK_KIND_KEY,
  Y_BLOCK_PROPS_KEY,
  Y_BLOCK_TEXT_KEY,
  Y_BODY_KEY,
  Y_META_FIELDS,
  Y_META_KEY,
  Y_PARTREFS_KEY,
  Y_PARTS_KEY,
} from "./schema";
export {
  seedYDoc,
  buildBlockYMap,
  buildSkeletonBlockYMap,
  populateBlockContent,
  populateParagraphContent,
  populateParagraphYMap,
} from "./seed";
export { projectYDoc, projectBlock } from "./project";
export {
  applyDocumentToYDoc,
  applyPartRefsToYDoc,
  removePartRefsFromYDoc,
} from "./apply";
export {
  type DeltaOp,
  type EmbedContent,
  type LinkMark,
  attrsToRunProps,
  deepEqual,
  deltaToRuns,
  runPropsToAttrs,
  runsToDelta,
} from "./runs";
export { diffApplyText } from "./textDiff";
