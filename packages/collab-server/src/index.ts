/**
 * @sobree/collab-server — Node-only y-protocol relay + persister.
 *
 * Hosts many Sobree rooms in one process. Each room is one Y.Doc
 * shared by N peers. The server doesn't instantiate an Editor and
 * doesn't know about Sobree's AST — it speaks pure y-protocol.
 *
 * # Bring your own persistence
 *
 * Ship with `filesystemPersistence` (one file per room) and
 * `memoryPersistence` (ephemeral). For production at scale write a
 * custom backend against S3 / R2 / Postgres / Redis — see the
 * `Persistence` interface (small: load + save + optional delete).
 */

export { SobreeCollabServer } from "./server";
export type {
  CollabServerOptions,
  ConnectionDecision,
  PeerInfo,
} from "./server";

export { Room } from "./room";
export type { RoomOptions, PeerState } from "./room";

export {
  filesystemPersistence,
  memoryPersistence,
} from "./persistence";
export type { Persistence, FilesystemPersistenceOptions } from "./persistence";

export {
  MESSAGE_AWARENESS,
  MESSAGE_ASSETS,
  MESSAGE_SESSION,
  MESSAGE_SYNC,
  decodeMessageHeader,
  decodeSessionMessage,
  encodeAwarenessMessage,
  encodeSessionMessage,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
  readSyncMessage,
} from "./protocol";
export type { DecodedMessage, SessionPayload } from "./protocol";
