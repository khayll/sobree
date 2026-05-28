import type * as Y from "yjs";

/**
 * Common shape for every provider helper in this package. The
 * underlying Yjs providers don't share an interface (each has its own
 * connect / disconnect / awareness API), so we normalize to this
 * triple. `provider` is typed as `unknown` deliberately — peek at it
 * for provider-specific advanced use, but most callers should only
 * need `awareness` and `destroy`.
 */
export interface CollabHandle {
  /** The underlying Yjs provider instance. Type-cast to its concrete
   *  type if you need provider-specific events / methods. */
  readonly provider: unknown;
  /** Awareness state (cursors, presence). May be `null` for providers
   *  that don't expose awareness (e.g. `y-indexeddb`). */
  readonly awareness: import("y-protocols/awareness").Awareness | null;
  /** Resolves once the provider has finished its initial sync. For
   *  network providers this means "caught up to the room"; for
   *  `y-indexeddb` this means "loaded local snapshot". */
  readonly synced: Promise<void>;
  /** Tear down: disconnect, remove listeners. Idempotent. */
  destroy(): void;
}

/** Bare-minimum shape Sobree needs from a provider. Useful for custom
 *  providers (BroadcastChannel, MessagePort, in-memory test loopback). */
export interface BasicProvider {
  destroy(): void;
}

export interface IdentityOptions {
  /** Stable id for this peer. Defaults to a random uuid per page load. */
  userId?: string;
  /** Display name shown to other peers in awareness. */
  name?: string;
  /** CSS color for the user's caret / range highlight. */
  color?: string;
}

/** Optional first-class doc store on a Y.Doc — what `editor.ydoc` is. */
export type AnyYDoc = Y.Doc;

/**
 * Session payload — Sobree-extension session message (type 2) sent
 * by `@sobree/collab-server` immediately after a peer joins a room.
 * Mirrors the type in `@sobree/collab-server`'s `protocol.ts`.
 *
 * Embedders connecting to a Sobree collab-server can read this via a
 * custom y-websocket message handler; it tells the client whether
 * the room was empty (safe to seed `initialDocument`) and whether
 * they're allowed to mutate the document.
 *
 * See the collab-server README "leader election" section for the
 * wire-level integration pattern.
 */
export interface CollabSessionPayload {
  /** True iff the Y.Doc was empty when this peer joined. Only one
   *  peer per fresh room sees this set. */
  isEmpty: boolean;
  /** Whether the server will accept Y sync-update messages from
   *  this peer. */
  isWritable: boolean;
  /** Other peers currently in the room (excluding this one). */
  peerCount: number;
}
