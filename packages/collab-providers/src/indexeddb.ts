import type { CollabHandle } from "./types";
import type * as Y from "yjs";

export interface IndexedDBProviderOptions {
  /** Database name. Each name is a separate IndexedDB store. Use one
   *  per document if you want isolated persistence. */
  dbName: string;
}

/**
 * Attach a `y-indexeddb` provider for local persistence. The Y.Doc's
 * state is stored in the browser's IndexedDB; reloading the page
 * restores the document.
 *
 * Requires `y-indexeddb` as a peer dep — install it explicitly:
 *
 * ```sh
 * pnpm add y-indexeddb
 * ```
 *
 * No awareness — local persistence only. The `synced` promise resolves
 * when the existing snapshot has been loaded into the Y.Doc.
 *
 * Usage:
 *
 * ```ts
 * import * as Y from "yjs";
 * import { createSobree } from "@sobree/core";
 * import { attachIndexedDBProvider } from "@sobree/collab-providers";
 *
 * const ydoc = new Y.Doc();
 * const handle = await attachIndexedDBProvider(ydoc, {
 *   dbName: "doc-q2-brief",
 * });
 * await handle.synced; // optional — wait for initial load
 * const editor = createSobree("#editor", { ydoc });
 * ```
 */
export async function attachIndexedDBProvider(
  ydoc: Y.Doc,
  opts: IndexedDBProviderOptions,
): Promise<CollabHandle> {
  const yidb = await loadYIndexedDB();
  const provider = new yidb.IndexeddbPersistence(opts.dbName, ydoc);

  const synced = new Promise<void>((resolve) => {
    provider.once("synced", () => resolve());
  });

  return {
    provider,
    awareness: null,
    synced,
    destroy(): void {
      provider.destroy();
    },
  };
}

async function loadYIndexedDB(): Promise<typeof import("y-indexeddb")> {
  try {
    return await import("y-indexeddb");
  } catch (err) {
    throw new Error(
      "y-indexeddb is not installed. Run `pnpm add y-indexeddb` (or `npm install y-indexeddb`) " +
        "and import this module again. See https://github.com/yjs/y-indexeddb.",
      { cause: err },
    );
  }
}
