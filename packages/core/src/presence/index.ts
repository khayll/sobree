/**
 * Presence — remote peer cursors and selection highlights.
 *
 * Builds on the Y.Doc backing in `@sobree/core`. Pass an `Awareness`
 * instance (from `y-protocols/awareness`, surfaced via
 * `@sobree/collab-providers` handles) and a user identity; pluck
 * remote peers via `getPeers()` or render the default overlay.
 *
 * See `concepts/architecture` ("Y.Doc store") for the bigger picture
 * and `api/create-sobree` ("Y.Doc + collaboration") for the
 * multi-phase roadmap.
 */

export { attachPresence } from "./attach";
export type {
  AttachPresenceOptions,
  PresenceHandle,
} from "./attach";

export { attachPresenceOverlay } from "./overlay";
export type {
  AttachPresenceOverlayOptions,
  PresenceOverlayHandle,
} from "./overlay";

export {
  isPresenceState,
  presenceSelectionFromEditor,
} from "./state";
export type {
  PresenceState,
  PresenceSelection,
  PresenceUser,
} from "./state";

export type { AwarenessLike, AwarenessChanges } from "./awareness";
