/**
 * Editor-surface types — the public type vocabulary of the `Editor`
 * façade (events, payloads, command bus, options, tracked-change spans).
 *
 * Extracted from `editor/index.ts` so that:
 *   1. the 3000+-line editor module stays focused on behaviour, and
 *   2. helper modules (`internal/mutations`, `plugins/marks`) can import
 *      these shared types from a leaf module instead of reaching back
 *      into `editor/index.ts` — which created an import cycle.
 *
 * Re-exported from `editor/index.ts`, so the public surface is unchanged.
 */

import type * as Y from "yjs";
import type { BlobStore } from "../blob";
import type {
  Range as ApiRange,
  BlockRef,
  EditResult,
  InlinePosition,
  Selection,
} from "../doc/api";
import type { RunPropertiesPatch } from "../doc/runs";
import type {
  Block,
  HeaderFooterRef,
  NamedStyle,
  PageMargins,
  PageSize,
  ParagraphAlignment,
  ParagraphProperties,
  SectionColumns,
  SectionProperties,
  SobreeDocument,
} from "../doc/types";

export type ApiRangeType = ApiRange;

export type {
  CellRef,
  InsertAt,
  InsertColumnOpts,
  InsertRowOpts,
  MergeCellsOpts,
} from "./table";

/**
 * One logical tracked change — a maximal run of consecutive inline
 * runs that all carry a `revision` marker by the same author.
 * `getRevisions()` returns these; pass `range` straight to
 * `acceptRevision` / `rejectRevision`.
 *
 * `kinds` is the set of revision types in the span: `["ins"]` or
 * `["del"]` for a plain change, both for a delete-then-insert
 * replacement (which accepts/rejects as a single unit).
 */
export interface RevisionSpan {
  range: ApiRange;
  author?: string;
  kinds: ("ins" | "del")[];
  /** ISO date of the span's first revision run, if recorded. */
  date?: string;
  /**
   * Discriminator between revision levels:
   *   `"inline"` (default for backwards compat) — the span covers
   *     `ins`/`del` text runs inside a block. Pass `range` to
   *     `acceptRevision` / `rejectRevision`.
   *   `"paragraph"` — the span flags the *paragraph mark* itself on
   *     `range.from.block`. The range covers offset `[0, length]` of
   *     the block so it still selects the right element for UIs, but
   *     accept/reject must go through `acceptParagraphRevision` /
   *     `rejectParagraphRevision`.
   *   `"format"` — the span flags a tracked format change
   *     (`<w:rPrChange>`) on contiguous runs by the same author.
   *     `kinds` always reports `["ins"]` (the marker is binary: a
   *     format change exists or not). Pass `range` to
   *     `acceptFormatRevision` / `rejectFormatRevision`.
   */
  level?: "inline" | "paragraph" | "format";
}

/**
 * Track-changes mode. When `enabled` is true, the editor reinterprets
 * authoring mutations as tracked revisions rather than direct edits:
 *
 *   - `insertRun` stamps `revision: { type: "ins", author }` on the
 *     inserted run instead of merging it in plainly.
 *   - `deleteRange` stamps `revision: { type: "del", author }` on the
 *     plain text runs in range instead of dropping them. A run that's
 *     already an `ins` *by the same author* is dropped instead — the
 *     author cancelling their own pending insert — and runs already
 *     carrying a peer's revision are left untouched (the API user must
 *     resolve those via `acceptRevision` / `rejectRevision` first).
 *   - All other mutations (`applyRunProperties`, block-level ops, etc.)
 *     pass through unchanged in this first cut; format-change tracking
 *     (`<w:rPrChange>`) and paragraph-mark tracking will land later.
 *
 * `author` is the human-readable name written into the revision
 * marker. Optional — falls back to no `author` field, mirroring the
 * Word semantics for anonymous-author tracked changes.
 *
 * This is the *authoring* side of the review feature. `getRevisions`
 * / `acceptRevision` / `rejectRevision` are the *consumption* side
 * and work the same regardless of this flag.
 */
export interface TrackChangesState {
  enabled: boolean;
  author?: string;
}

/**
 * Payload delivered to `change` subscribers. Plain data — safe to
 * JSON-stringify and ship over a wire. `rawParts` is stripped from
 * `document` so the payload never carries binary Uint8Arrays.
 */
export interface ChangePayload {
  doc: SobreeDocument;
  /**
   * @deprecated Use `doc` instead. This alias is kept for backwards
   * compatibility within the pre-1.0 line and will be removed before
   * v1. Same reference as `doc`.
   */
  document: SobreeDocument;
  revision: number;
  documentVersion: number;
}

/** Summary of a top-level block, for `getBlocks()` and list-style UIs. */
export interface BlockInfo {
  /** Current position in the body (unstable across edits). */
  index: number;
  /** Stable id — pair with `version` to form a `BlockRef`. */
  id: string;
  /** Bumps on every modification of this block. */
  version: number;
  kind: Block["kind"];
  styleId?: string;
  alignment?: ParagraphAlignment;
  /** Plain-text preview. */
  text: string;
  /** Total character-length of the block's content (see `runsLength`). */
  length: number;
}

/** Outline entry — one per heading in document order. */
export interface OutlineItem {
  level: number;
  text: string;
  blockIndex: number;
  block: BlockRef;
}

export type ParagraphPropertiesPatch = {
  [K in keyof ParagraphProperties]?: ParagraphProperties[K] | undefined;
};

/**
 * Patch for a section's properties (page geometry, columns, header/footer
 * refs, vertical alignment). `pageSize` / `pageMargins` are FIELD-merged
 * into the existing values (so a partial — e.g. just `orientation` or
 * `topTwips` — stays valid); every other field REPLACES wholesale, and an
 * explicit `undefined` on an optional field clears it.
 */
export interface SectionPropertiesPatch {
  pageSize?: Partial<PageSize>;
  pageMargins?: Partial<PageMargins>;
  columns?: SectionColumns | undefined;
  headerRefs?: HeaderFooterRef[];
  footerRefs?: HeaderFooterRef[];
  titlePage?: boolean | undefined;
  type?: SectionProperties["type"];
  vAlign?: SectionProperties["vAlign"];
}

/**
 * Patch for an existing named style (everything except its `id`). Each
 * present field replaces the style's corresponding field wholesale; an
 * explicit `undefined` clears an optional one. The required `type` /
 * `displayName` are never cleared.
 */
export type NamedStylePatch = {
  [K in keyof Omit<NamedStyle, "id">]?: NamedStyle[K] | undefined;
};

export type WrapTag = "sup" | "sub" | "strong" | "em" | "u" | "s" | "mark";

/** The slice of selection state plugins read (see {@link EditorLike}). */
export interface EditorSelectionLike {
  currentRange(): ApiRange | null;
  currentCaret(): InlinePosition | null;
}

/**
 * The minimal `Editor` contract that framework-free plugins depend on
 * (mark toggles, etc.). Plugins type against this instead of the
 * concrete `Editor` class so they don't import `editor/index.ts` — that
 * kept a (type-only) import cycle alive and coupled plugins to the
 * whole editor module. The `Editor` class structurally satisfies it.
 */
export interface EditorLike {
  getDocument(): SobreeDocument;
  getBlocks(): BlockInfo[];
  getBlockById(id: string): BlockInfo | null;
  applyRunProperties(
    range: ApiRange,
    patch: RunPropertiesPatch,
    opts?: { expect?: Record<string, number> },
  ): EditResult<void>;
  wrapRange(
    range: ApiRange,
    tag: WrapTag,
    opts?: { expect?: Record<string, number> },
  ): EditResult<void>;
  readonly selection: EditorSelectionLike;
}

export type EditorEvent = "change" | "selection" | "keydown" | "track-changes-change";
export type EditorEventPayload = {
  change: ChangePayload;
  selection: SelectionPayload;
  keydown: KeyDownPayload;
  "track-changes-change": TrackChangesState;
};
export type Unsubscribe = () => void;

/**
 * Payload delivered to `selection` subscribers. Fires whenever the live
 * DOM selection changes — typing, clicking, arrow-key navigation, focus
 * loss, programmatic restore. Subscribers should subscribe through the
 * editor rather than `document.addEventListener("selectionchange")`
 * directly so cleanup is centralised and the editor can later add
 * dedup / throttling.
 *
 * `selection` is the model shape (`null` when focus is outside the
 * editor). The convenience fields below mirror what `EditorSelection`
 * exposes for ergonomics — read whichever one you need.
 */
export interface SelectionPayload {
  selection: Selection;
  range: ApiRange | null;
  caret: InlinePosition | null;
  block: BlockRef | null;
}

/**
 * Payload delivered to `keydown` subscribers. Fires for every key press
 * inside the editor host. The editor binds NO shortcuts itself —
 * plugins map keys to API calls via `preventDefault()` (stops the
 * browser's default action) and `stopPropagation()` (stops the chain
 * of remaining subscribers). Subscribers fire in registration order.
 */
export interface KeyDownPayload {
  /** `KeyboardEvent.key` — `"b"`, `"Enter"`, `"ArrowLeft"`, … (lowercased for letters). */
  key: string;
  /** `KeyboardEvent.code` — `"KeyB"`, `"Enter"`, `"ArrowLeft"`, … (layout-independent). */
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Stop the browser's default for this key (insertion, navigation, …). */
  preventDefault(): void;
  /** Stop further subscribers from receiving this key. */
  stopPropagation(): void;
  /** Underlying DOM event — for advanced needs (`isComposing`, repeat, …). */
  originalEvent: KeyboardEvent;
}

/**
 * A registered command — a named, callable unit of editor work that
 * plugins coordinate around. Same definition gets reached by a
 * keyboard shortcut, a toolbar click, a programmatic call from an
 * agent, or an MCP request.
 *
 * The `run` function is the one place the work happens. `isActive` and
 * `isAvailable` let UI plugins paint toggle / disabled state without
 * understanding what the command actually does.
 */
export interface CommandDefinition<Args = void> {
  /** Dotted, namespaced — `"mark.toggle.bold"`, `"section.insertBreak"`, … */
  name: string;
  /** Short human label for tooltips / command palettes. */
  title?: string;
  /** Perform the work. Should be idempotent w.r.t. selection (a second
   *  invocation on an already-bold selection clears bold, etc.). */
  run: (args: Args) => void;
  /** True when the command represents an active state (mark already on,
   *  block is already a heading, …). Drives toolbar `is-active`. */
  isActive?: () => boolean;
  /** False when the command can't run (e.g. selection is wrong shape).
   *  Defaults to true. Drives toolbar `disabled`. */
  isAvailable?: () => boolean;
}

/** Snapshot of one registered command — what `commands.list()` returns. */
export interface CommandSnapshot {
  name: string;
  title: string;
  isActive: boolean;
  isAvailable: boolean;
}

/**
 * Registry every plugin uses to talk to every other plugin. The
 * editor owns it; plugins register commands on attach and unregister
 * on detach. Keyboard plugins, toolbar plugins, and a future MCP
 * adapter all share the same dispatch path: `editor.commands.execute(name)`.
 */
export interface CommandBus {
  /** Register a command. Returns an unsubscribe that removes it. */
  register<Args = void>(def: CommandDefinition<Args>): () => void;
  /** Run a registered command. No-op (with a warning) if unknown. */
  execute<Args = void>(name: string, args?: Args): void;
  /** Snapshot every registered command — for command palettes,
   *  toolbars rendering toggle states, accessibility audits. */
  list(): CommandSnapshot[];
  /** Whether the named command is currently registered. */
  has(name: string): boolean;
}

export interface EditorOptions {
  initialDocument?: SobreeDocument;
  changeDebounceMs?: number;
  /**
   * Show hidden text (`<w:vanish/>`) from the start. Default `false` —
   * hidden text is not shown (print-faithful, matching Word/LibreOffice).
   * Toggle at runtime with `setShowHiddenText`. When shown, hidden runs
   * get a muted dotted underline so they can be read and edited.
   */
  showHiddenText?: boolean;
  /**
   * Elements whose children are editable blocks, in document order. Called
   * fresh each time — the list can grow/shrink (e.g. during pagination).
   */
  contentHosts?: () => HTMLElement[];
  /**
   * Y.Doc backing the document. Optional — if absent, the editor creates
   * one internally. Embedders pass their own when they need to attach
   * a provider (`y-websocket`, `y-indexeddb`, `y-webrtc`, …) for
   * persistence or collaboration.
   *
   * When supplied, the editor checks whether the Y.Doc already has body
   * content. If empty, it seeds from `initialDocument`. If non-empty
   * (Phase 2+: a peer joined an active room), the existing Y.Doc state
   * wins and `initialDocument` is ignored. See `editor.ydoc` for the
   * public escape hatch.
   */
  ydoc?: Y.Doc;
  /**
   * Optional content-hashed `BlobStore` for binary parts (images, fonts).
   *
   * Without one (default): bytes live inline in the Y.Doc's `parts`
   * Y.Map and replicate to every peer through Y updates. Fine for
   * small docs.
   *
   * With one: the editor hashes binary parts, uploads the bytes to the
   * store, and writes only the hash into the Y.Doc's `partRefs` Y.Map.
   * Y updates stay small regardless of image size. The editor maintains
   * a local `BlobCache` that synchronously serves already-fetched bytes
   * to the renderer; `editor.ensurePartsLoaded()` is the async hook for
   * explicit pre-fetching (e.g. before `toDocx()`).
   *
   * See `@sobree/core/blob` for the interface + reference impls
   * (`inMemoryBlobStore`, `fetchBlobStore`).
   */
  blobStore?: BlobStore;
  /**
   * Initial track-changes mode. When omitted, the editor starts in
   * direct-edit mode (`{ enabled: false }`) and embedders can flip it
   * later via `editor.setTrackChanges`. See `TrackChangesState`.
   */
  trackChanges?: TrackChangesState;
}
