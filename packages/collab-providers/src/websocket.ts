import type { CollabHandle, IdentityOptions } from "./types";
import type * as Y from "yjs";

export interface WebsocketProviderOptions extends IdentityOptions {
  /** WebSocket server URL (e.g. `wss://collab.example.com`). The room
   *  name is appended as a path. */
  url: string;
  /** Room name. Each room is one Y.Doc shared across peers. */
  room: string;
  /** Auth params appended to the WebSocket URL as query string. */
  params?: Record<string, string>;
  /** Connect immediately (default true). Set to false to call
   *  `provider.connect()` manually. */
  connect?: boolean;
}

/**
 * Attach a `y-websocket` provider to a Y.Doc.
 *
 * Requires `y-websocket` as a peer dep — install it explicitly:
 *
 * ```sh
 * pnpm add y-websocket
 * ```
 *
 * Returns a `CollabHandle` with the connected provider, awareness
 * (cursor / presence channel), and a `synced` promise that resolves
 * when the initial sync completes.
 *
 * Usage:
 *
 * ```ts
 * import * as Y from "yjs";
 * import { createSobree } from "@sobree/core";
 * import { attachWebsocketProvider } from "@sobree/collab-providers";
 *
 * const ydoc = new Y.Doc();
 * const handle = await attachWebsocketProvider(ydoc, {
 *   url: "wss://collab.example.com",
 *   room: "doc-q2-brief",
 *   name: "Alice",
 *   color: "#f59e0b",
 * });
 * const editor = createSobree("#editor", { ydoc });
 *
 * // Later:
 * editor.destroy();
 * handle.destroy();
 * ydoc.destroy();
 * ```
 */
export async function attachWebsocketProvider(
  ydoc: Y.Doc,
  opts: WebsocketProviderOptions,
): Promise<CollabHandle> {
  const yws = await loadYWebsocket();
  const params = opts.params ?? {};
  const provider = new yws.WebsocketProvider(opts.url, opts.room, ydoc, {
    params,
    connect: opts.connect ?? true,
  });

  if (opts.name || opts.color || opts.userId) {
    provider.awareness.setLocalStateField("user", {
      id: opts.userId ?? randomId(),
      name: opts.name ?? "Anonymous",
      color: opts.color ?? "#888",
    });
  }

  const synced = new Promise<void>((resolve) => {
    if (provider.synced) {
      resolve();
      return;
    }
    const handler = (isSynced: boolean) => {
      if (isSynced) {
        provider.off("sync", handler);
        resolve();
      }
    };
    provider.on("sync", handler);
  });

  return {
    provider,
    awareness: provider.awareness,
    synced,
    destroy(): void {
      provider.disconnect();
      provider.destroy();
    },
  };
}

async function loadYWebsocket(): Promise<typeof import("y-websocket")> {
  try {
    return await import("y-websocket");
  } catch (err) {
    throw new Error(
      "y-websocket is not installed. Run `pnpm add y-websocket` (or `npm install y-websocket`) " +
        "and import this module again. See https://github.com/yjs/y-websocket.",
      { cause: err },
    );
  }
}

function randomId(): string {
  // Sufficient for awareness peer ids; not crypto.
  return Math.random().toString(36).slice(2, 10);
}
