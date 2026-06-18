/**
 * `createSobree()` — the blessed factory for the 95% case.
 *
 * Wires `Viewport` + `Sobree` behind a single call, then mounts every
 * plugin the caller passed in `options.plugins`. Returns a flat handle
 * that surfaces the most-used methods directly, with escape hatches
 * (`.editor`, `.sobree`, `.viewport`) for power users.
 *
 * `@sobree/core` ships zero plugin packages — install the ones you
 * want (`@sobree/keyboard`, `@sobree/block-tools`,
 * `@sobree/zoom-controls`) and pass their factories through
 * `plugins: []`. Plugins are mounted in array order and torn down in
 * reverse on `destroy()`. For multi-peer collab, the editor's Y.Doc
 * is what providers (`y-websocket` from `@sobree/collab-providers`)
 * attach to — no separate wire-adapter plugin needed.
 */

import type { SobreeDocument } from "./doc/types";
import { exportDocx } from "./docx/export/index";
import type { CommandBus, Editor } from "./editor";
import { Viewport } from "./embed/viewport";
import { parseMarkdown } from "./markdown/parse";
import type { PageSetup } from "./paperStack/pageSetup";
import type { PluginContext, SobreePlugin, SobreePluginInstance } from "./plugin";
import { Sobree } from "./sobree";
import type { SobreeEvent, SobreeEventPayload, SobreeOptions, SobreeUnsubscribe } from "./sobree";

/**
 * Initial content. Type detection is automatic:
 *   - `string`            → seed-quality Markdown (see `parseMarkdown`)
 *   - `Blob` / `File`     → `.docx` bytes (loaded asynchronously)
 *   - `ArrayBuffer`       → `.docx` bytes
 *   - `Uint8Array`        → `.docx` bytes
 *   - `SobreeDocument`    → AST literal (use the builders to construct)
 *
 * For a `.docx` source, the constructor returns synchronously with an
 * empty editor and `.ready` resolves once the import lands. For all
 * other source types, `.ready` is already resolved when the factory
 * returns.
 */
export type SobreeContent = string | Blob | ArrayBuffer | Uint8Array | SobreeDocument;

/**
 * How the viewport is fitted on initial mount.
 *   - `"width"` (default) — first paper fills the host width; you see
 *     the document the way you'd read it.
 *   - `"page"` — first paper is fully contained (whole page visible).
 *   - `"none"` — leave the viewport at 1:1, no auto-fit.
 */
export type FitOnMount = "width" | "page" | "none";

export interface CreateSobreeOptions {
  /** Initial content. See `SobreeContent`. Default: empty document. */
  content?: SobreeContent;
  /** Page setup. Falls back to A4 portrait with 1in margins. */
  pageSetup?: PageSetup;
  /**
   * Plugins to mount. Each receives a `PluginContext` (editor +
   * viewport + sobree + host) on `setup()` and returns a destroyer.
   * Mounted in array order; destroyed in reverse on
   * `editor.destroy()`. See `@sobree/keyboard`, `@sobree/block-tools`,
   * `@sobree/zoom-controls` for stock factories. (`@sobree/collab-providers`
   * lands in Phase 2 for Yjs persistence / collaboration.)
   */
  plugins?: SobreePlugin[];
  /** Forwarded to the underlying Editor. */
  changeDebounceMs?: number;
  /**
   * Y.Doc backing the document. The editor mirrors every mutation into
   * this Y.Doc; embedders attach providers (`y-websocket`,
   * `y-indexeddb`, `y-webrtc`, …) for persistence / collaboration.
   * If absent, the editor creates one internally — still observable
   * via `editor.editor.ydoc`.
   */
  ydoc?: import("yjs").Doc;
  /**
   * Optional content-hashed `BlobStore` for binary parts (Phase 3.2+).
   * Without one, binary parts (images, fonts) ride inline in the
   * Y.Doc; with one, they go through the BlobStore and the Y.Doc
   * carries only hashes. See `EditorOptions.blobStore` for the full
   * contract.
   */
  blobStore?: import("./blob").BlobStore;
  /**
   * Auto-fit the viewport to the first paper after mount. Default
   * `"width"` — what most embedders want for a "looks right out of the
   * box" first impression. Pass `"none"` if you're driving the
   * viewport yourself.
   */
  fitOnMount?: FitOnMount;
  /**
   * Show a small, non-interactive `@sobree/core` version badge at the
   * bottom-centre of the screen. Off by default. A debug aid for
   * confirming which renderer build is live (e.g. past a stale cache
   * after a deploy). Forwarded to `SobreeOptions.versionBadge`.
   */
  versionBadge?: boolean;
  /**
   * Show hidden text (`<w:vanish/>`) from the start. Off by default
   * (print-faithful — matches Word/LibreOffice). Toggle at runtime with
   * the returned `setShowHiddenText`. Forwarded to
   * `SobreeOptions.showHiddenText`.
   */
  showHiddenText?: boolean;
}

/**
 * The editor handle returned by `createSobree()`. Proxies the most-used
 * methods of the underlying `Sobree` + `Editor` so embedders rarely
 * need to reach through. Power users can use `.sobree` / `.editor` /
 * `.viewport` directly.
 *
 * Plugin instances are NOT exposed on the handle — plugins self-manage
 * after handoff. Reach through `.editor` for command bus / events.
 */
export interface SobreeHandle {
  // === escape hatches ===
  readonly sobree: Sobree;
  readonly editor: Editor;
  readonly viewport: Viewport;
  /**
   * The Y.Doc backing the document. Provided so embedders can attach
   * Yjs providers (`y-websocket`, `y-indexeddb`, `y-webrtc`) for
   * persistence / collaboration without reaching through `editor.editor`.
   * Same reference as `editor.editor.ydoc`.
   */
  readonly ydoc: import("yjs").Doc;

  // === readiness ===
  /**
   * Resolves when the constructor's `content` has finished loading. For
   * docx content this awaits the import; for everything else this is an
   * already-resolved promise.
   */
  readonly ready: Promise<{ warnings: string[] }>;

  // === document I/O ===
  getDocument(): SobreeDocument;
  setDocument(doc: SobreeDocument): void;
  /** Show or hide hidden text (`<w:vanish/>`). Off by default. */
  setShowHiddenText(show: boolean): void;
  /** Replace the document with one parsed from a Markdown string (seed-quality). */
  loadMarkdown(md: string): void;
  /** Load a `.docx` file. Resolves with any import warnings. */
  loadDocx(src: File | Blob | ArrayBuffer | Uint8Array): Promise<{ warnings: string[] }>;
  /**
   * Serialise the current document to a `.docx` Blob. Uses bytes
   * currently cached locally — if a `blobStore` is configured and
   * some referenced parts aren't yet cached, call
   * `await handle.ensurePartsLoaded()` first to pre-fetch them.
   * Missing parts appear in `warnings`.
   */
  toDocx(): { blob: Blob; warnings: string[] };
  /**
   * Wait for every currently-referenced binary part to be available
   * in the local cache. No-op when no `blobStore` is configured.
   */
  ensurePartsLoaded(): Promise<void>;

  // === page setup ===
  getPageSetup(): PageSetup;
  setPageSetup(partial: Partial<PageSetup>): void;

  // === commands + events ===
  readonly commands: CommandBus;
  on<E extends SobreeEvent>(
    event: E,
    cb: (payload: SobreeEventPayload[E]) => void,
  ): SobreeUnsubscribe;

  // === lifecycle ===
  destroy(): void;
}

/**
 * Mount a fully-wired Sobree editor (Viewport + Sobree + user plugins)
 * into `target` (CSS selector or HTMLElement). See `CreateSobreeOptions`
 * and `SobreeHandle` for the full surface.
 */
export function createSobree(
  target: string | HTMLElement,
  options: CreateSobreeOptions = {},
): SobreeHandle {
  const host = resolveHost(target);

  // Build initial document for the synchronous content paths.
  // Async (docx) starts empty; `ready` reflects the load.
  const { initialDocument, deferredDocx } = resolveInitialContent(options.content);

  const viewport = new Viewport(host);

  // `exactOptionalPropertyTypes: true` forbids `T | undefined` on
  // optional fields, so spread-when-truthy. `changeDebounceMs` uses
  // `!== undefined` because 0 is a valid value.
  const sobreeOpts: SobreeOptions = {
    ...(initialDocument && { initialDocument }),
    ...(options.pageSetup && { pageSetup: options.pageSetup }),
    ...(options.changeDebounceMs !== undefined && {
      changeDebounceMs: options.changeDebounceMs,
    }),
    ...(options.ydoc && { ydoc: options.ydoc }),
    ...(options.blobStore && { blobStore: options.blobStore }),
    ...(options.versionBadge && { versionBadge: true }),
    ...(options.showHiddenText && { showHiddenText: true }),
  };

  const sobree = new Sobree(viewport.slot, sobreeOpts);

  // Plugin loop. Each plugin's setup runs in array order; their
  // destroyers run in reverse on `destroy()`. A plugin that throws
  // during setup is logged and skipped — its peers still mount.
  const ctx: PluginContext = {
    editor: sobree.editor,
    sobree,
    viewport,
    host,
  };
  const pluginInstances: Array<{
    name: string | undefined;
    instance: SobreePluginInstance;
  }> = [];
  for (const plugin of options.plugins ?? []) {
    try {
      const instance = plugin.setup(ctx);
      pluginInstances.push({ name: plugin.name, instance });
    } catch (err) {
      console.error(`[sobree] plugin "${plugin.name ?? "?"}" setup failed:`, err);
    }
  }

  // openDocx surfaces import warnings via the `docx:import` event. The
  // sink subscribes BEFORE openDocx fires so the warnings land in-band
  // on the `ready` promise's resolution value.
  let ready: Promise<{ warnings: string[] }>;
  if (deferredDocx) {
    const sink = installWarningSink(sobree);
    ready = sobree.openDocx(deferredDocx).then(() => ({ warnings: sink.warnings }));
  } else {
    ready = Promise.resolve({ warnings: [] });
  }

  // Auto-fit the viewport once the host has dimensions and the first
  // paper has been laid out. Sync content fits on the next animation
  // frame; deferred docx fits after the import resolves.
  const fitOnMount: FitOnMount = options.fitOnMount ?? "width";
  if (fitOnMount !== "none") {
    const mode = fitOnMount === "page" ? "contain" : "width";
    const applyFit = (): void => {
      // Skip if the host hasn't been laid out yet (display:none, etc.).
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      viewport.fitTo(sobree.firstPaper, mode, false);
    };
    if (deferredDocx) {
      ready.then(() => requestAnimationFrame(applyFit));
    } else {
      requestAnimationFrame(applyFit);
    }
  }

  const handle: SobreeHandle = {
    sobree,
    get editor() {
      return sobree.editor;
    },
    viewport,
    get ydoc() {
      return sobree.editor.ydoc;
    },
    ready,

    getDocument: () => sobree.editor.getDocument(),
    // setDocument / loadMarkdown both flow through editor.setDocument,
    // which fires `change`; Sobree's change handler runs
    // `syncSetupFromDocument` to re-derive page setup from the new
    // `sections[0]`. So an A5 doc (or any doc with non-default page
    // setup) automatically retunes the renderer — no explicit page-
    // setup overlay needed here.
    setDocument: (doc) => sobree.editor.setDocument(doc),
    setShowHiddenText: (show) => sobree.editor.setShowHiddenText(show),
    loadMarkdown: (md) => sobree.editor.setDocument(parseMarkdown(md)),
    loadDocx: async (src) => {
      const sink = installWarningSink(sobree);
      await sobree.openDocx(src);
      return { warnings: sink.warnings };
    },
    toDocx: () => {
      // Sobree.exportDocx() returns just the Blob (warnings via event);
      // we want them in-band. Re-call the underlying serialiser instead.
      return exportDocx(sobree.editor.getDocument());
    },
    ensurePartsLoaded: () => sobree.editor.ensurePartsLoaded(),

    getPageSetup: () => sobree.getPageSetup(),
    setPageSetup: (partial) => sobree.setPageSetup(partial),

    get commands() {
      return sobree.editor.commands;
    },
    on: (event, cb) => sobree.on(event, cb),

    destroy: () => {
      // Plugins down first, in reverse-of-setup order (LIFO). A
      // failing destroy is logged but doesn't stop peers from
      // tearing down — leaks are bad, but partial teardown beats
      // none.
      for (let i = pluginInstances.length - 1; i >= 0; i--) {
        const entry = pluginInstances[i]!;
        try {
          entry.instance.destroy();
        } catch (err) {
          console.error(`[sobree] plugin "${entry.name ?? "?"}" destroy failed:`, err);
        }
      }
      sobree.destroy();
      // Viewport doesn't currently expose a destroy; the next page nav
      // tears its listeners down with the host element.
    },
  };
  return handle;
}

// === helpers ===

function resolveHost(target: string | HTMLElement): HTMLElement {
  if (typeof target === "string") {
    const el = document.querySelector(target);
    if (!(el instanceof HTMLElement)) {
      throw new Error(`[sobree] createSobree: selector "${target}" did not match an HTMLElement.`);
    }
    return el;
  }
  return target;
}

interface ResolvedContent {
  initialDocument: SobreeDocument | undefined;
  deferredDocx: Blob | ArrayBuffer | Uint8Array | undefined;
}

function resolveInitialContent(content: SobreeContent | undefined): ResolvedContent {
  if (content === undefined) {
    return { initialDocument: undefined, deferredDocx: undefined };
  }
  if (typeof content === "string") {
    return { initialDocument: parseMarkdown(content), deferredDocx: undefined };
  }
  if (isDocxSource(content)) {
    return { initialDocument: undefined, deferredDocx: content };
  }
  // Treat as AST literal; final shape-check is delegated to the editor.
  return { initialDocument: content, deferredDocx: undefined };
}

function isDocxSource(v: unknown): v is Blob | ArrayBuffer | Uint8Array {
  if (typeof Blob !== "undefined" && v instanceof Blob) return true;
  if (v instanceof ArrayBuffer) return true;
  if (v instanceof Uint8Array) return true;
  return false;
}

/**
 * Subscribe to the next `docx:import` event and stash its warnings so
 * the convenience methods can return them in-band. The returned object's
 * `warnings` field is mutated by the listener.
 */
function installWarningSink(sobree: Sobree): { warnings: string[] } {
  const sink = { warnings: [] as string[] };
  const off = sobree.on("docx:import", (p) => {
    sink.warnings = p.warnings;
    off();
  });
  return sink;
}
