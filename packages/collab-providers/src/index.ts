/**
 * @sobree/collab-providers — thin Yjs provider helpers for @sobree/core.
 *
 * Each helper is a one-line factory around the canonical Yjs provider
 * (`y-websocket`, `y-indexeddb`, `y-webrtc`). They normalize the
 * different provider APIs to a single `CollabHandle` shape:
 *
 *   { provider, awareness, synced, destroy() }
 *
 * The underlying provider packages are **optional peer deps** —
 * install only the ones you need. The factories lazy-import them and
 * throw a clear error if missing.
 *
 * Plus an in-memory `loopback()` for tests / demos that wires two
 * Y.Docs together with no network.
 */

export { attachWebsocketProvider } from "./websocket";
export type { WebsocketProviderOptions } from "./websocket";

export { attachIndexedDBProvider } from "./indexeddb";
export type { IndexedDBProviderOptions } from "./indexeddb";

export { attachWebRTCProvider } from "./webrtc";
export type { WebRTCProviderOptions } from "./webrtc";

export { loopback } from "./loopback";

export type {
  BasicProvider,
  CollabHandle,
  CollabSessionPayload,
  IdentityOptions,
} from "./types";
