/**
 * @sobree/core — public surface.
 *
 * The kernel: framework-free Editor + AST + serializers, the paginated
 * paper stack, the floating block tools, header /
 * footer zone editor, and the `Sobree` façade that composes them.
 *
 * Embedders typically only need:
 *
 *   import { createSobree } from "@sobree/core";
 *   import "@sobree/core/tokens.css";
 */

// === blessed factory (the 95% path) ===
export { createSobree } from "./createSobree";
export type {
  CreateSobreeOptions,
  SobreeContent,
  SobreeHandle,
} from "./createSobree";

// === build metadata ===
export { VERSION } from "./version";

// === markdown seed parser (for hello-world content) ===
export { parseMarkdown } from "./markdown/parse";

// === façade ===
export { Sobree } from "./sobree";
export type {
  SobreeMode,
  SobreeOptions,
  SobreeEvent,
  SobreeEventPayload,
  SobreeUnsubscribe,
} from "./sobree";

// === plugin contract ===
export type {
  SobreePlugin,
  SobreePluginInstance,
  PluginContext,
} from "./plugin";

// === editor + AST + commands ===
export { Editor } from "./editor";
// Rendered-document lookup surface (`editor.renderedDocument`) — the
// typed bridge plugins use instead of hardcoding renderer DOM selectors.
export { RenderedDocument } from "./editor";
export type {
  RenderedBlockLookup,
  RenderedCommentLookup,
  RenderedCommentRange,
  RenderedDocumentIndex,
  RenderedRevisionKind,
  RenderedRevisionLookup,
  RenderedRevisionMark,
} from "./editor";
export type {
  ApiRangeType,
  RevisionSpan,
  BlockInfo,
  ChangePayload,
  CommandBus,
  CommandDefinition,
  CommandSnapshot,
  EditorEvent,
  EditorEventPayload,
  EditorOptions,
  EditError,
  EditResult,
  KeyDownPayload,
  OutlineItem,
  ParagraphPropertiesPatch,
  RunPropertiesPatch,
  SelectionPayload,
  TrackChangesState,
  Unsubscribe,
  WrapTag,
  // table sub-API types
  CellRef,
  InsertAt,
  InsertColumnOpts,
  InsertRowOpts,
  MergeCellsOpts,
} from "./editor";

// === document model ===
export * from "./doc/types";
export * from "./doc/builders";
export { resolveStyleCascade } from "./doc/styles";

// === fonts ===
// Pure-function API for embedding/removing fonts and the @font-face
// runtime registry. The Editor's `embedFont()` / `removeEmbeddedFont()`
// wrap these — re-exported here for headless consumers (Workers,
// pipelines, custom Editor mounts).
export {
  embedFontIntoDoc,
  removeFontFromDoc,
  FontFaceRegistry,
  generateFontKey,
  obfuscate,
  deobfuscate,
  canEmbed,
  readFsType,
} from "./fonts";
export type {
  EmbedFontFaces,
  EmbedFontOptions,
  EmbedFontResult,
  EmbedMode,
  FsTypeReport,
} from "./fonts";

// === history (undo / redo) ===
// `editor.history` is a `History` instance — Phase 1b.6+ a thin
// wrapper around `Y.UndoManager`. Re-exporting the types for callers
// who want strongly-typed listener subscriptions or to instantiate
// the helper directly in headless tests.
export { DEFAULT_HISTORY_CONFIG, History } from "./history";
export type {
  HistoryConfig,
  HistoryDepth,
  HistoryEvent,
  HistoryListener,
} from "./history";
export { templateToBlocks, blocksToTemplate } from "./doc/pageSetupBridge";
export type { Selection, BlockRef, InlinePosition, Range } from "./doc/api";

// === paper stack + page setup model ===
export { PaperStack } from "./paperStack/paperStack";
export { Paper } from "./paperStack/paper";
export { PAGE_SIZES, DEFAULT_PAGE_SETUP } from "./paperStack/pageSetup";
export type {
  PageSetup,
  PageSizeKey,
  PageZoneText,
  VerticalAlign,
  Orientation,
  Margins,
} from "./paperStack/pageSetup";

// === viewport ===
export { Viewport } from "./embed/viewport";
export type { ViewportOptions } from "./embed/viewport";

// === shared floating-corner stack (used by zoom-controls, review dock, …) ===
export { getFloatingCorner } from "./embed/floatingCorner";
export type { FloatingCornerPlacement } from "./embed/floatingCorner";

// === editor plugins (default-shipped) ===
export { attachSections } from "./plugins/sections";

// === mark helpers (used by toolbars + agents to toggle bold/italic/etc.) ===
export {
  MARK_COMMAND_DEFS,
  MARK_PROP,
  MARK_ON,
  toggleMark,
  isMarkActive,
  rangeAtSelection,
} from "./plugins/marks";
export type { MarkCommandDef, ToggleableMark } from "./plugins/marks";

// === header / footer zone editor ===
export { enterZoneEdit } from "./zoneEdit";
export type { ZoneKind, EnterZoneEditOptions } from "./zoneEdit";

// === Y.Doc backing (Phase 1+) ===
// The document is mirrored into a Y.Doc on every mutation. Paragraph
// blocks store text as Y.Text (char-level CRDT); other blocks +
// document meta as JSON. Embedders reach `editor.editor.ydoc` for the
// live Y.Doc; these three are the blessed wire-level contract — seed a
// fresh Y.Doc, project one back to a SobreeDocument, diff-apply a full
// document. The schema keys and Run↔Delta conversion are internals:
// anything finer-grained than these three couples the consumer to the
// Y.Doc layout, which only `@sobree/core` owns.
export { applyDocumentToYDoc, projectYDoc, seedYDoc } from "./ydoc";

// === content-hashed blob layer (Phase 3.2+) ===
// Optional. Pass a `BlobStore` to `createSobree({ blobStore })` and
// binary parts (images, fonts) go through the side-channel store
// instead of riding inline in Y.Doc updates. Two reference impls
// ship: `inMemoryBlobStore` (tests / local) and `fetchBlobStore`
// (HTTP). Production deployments typically write their own against
// S3 / R2 / Postgres — the interface is three methods.
export {
  BlobCache,
  BlobStoreError,
  fetchBlobStore,
  inMemoryBlobStore,
  isBlobHash,
  sha256Hex,
} from "./blob";
export type {
  BlobCacheOptions,
  BlobHash,
  BlobStore,
  FetchBlobStoreOptions,
} from "./blob";

// === headless peer ===
// A no-DOM Sobree peer for LLM agents, automation, MCP servers, etc.
// Same mutation API as the browser editor but operates on a Y.Doc
// directly without rendering. Pair with a Yjs provider
// (`y-websocket`, `y-webrtc`, the in-memory `loopback()`) to sync
// with browser peers.
export { HeadlessSobree } from "./headless";
export type {
  HeadlessChangePayload,
  HeadlessEvent,
  HeadlessSobreeOptions,
  HeadlessUnsubscribe,
} from "./headless";

// === presence (Phase 2.2+) ===
// Remote cursors + selection highlights via Yjs awareness. Pass an
// `Awareness` instance (from `y-protocols/awareness`, surfaced via
// `@sobree/collab-providers` handles) + a user identity.
export {
  attachPresence,
  attachPresenceOverlay,
  isPresenceState,
  presenceSelectionFromEditor,
} from "./presence";
export type {
  AttachPresenceOptions,
  AttachPresenceOverlayOptions,
  AwarenessChanges,
  AwarenessLike,
  PresenceHandle,
  PresenceOverlayHandle,
  PresenceSelection,
  PresenceState,
  PresenceUser,
} from "./presence";
