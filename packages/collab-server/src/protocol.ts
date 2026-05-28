/**
 * y-protocol message wire format helpers.
 *
 * Message envelope: one varuint message-type tag, then a type-specific
 * payload. Standard types:
 *
 *   - 0 (sync) — y-protocols/sync. Sub-types: 0=sync-step-1,
 *     1=sync-step-2, 2=update. We don't peek inside; the message is
 *     forwarded to `readSyncMessage` from y-protocols.
 *   - 1 (awareness) — y-protocols/awareness encoded update.
 *
 * Future Sobree extensions (Phase 4+):
 *
 *   - 2 (session) — auth handshake, room metadata, peer identity
 *   - 3 (assets) — out-of-band binary part announcements
 *
 * For Phase 3.1 we only handle 0 and 1.
 */

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/**
 * Session message — server → client, sent once immediately after the
 * peer joins a room. Tells the client:
 *
 *   - whether the room was empty when they joined (so they're allowed
 *     to seed with their `initialDocument`)
 *   - their granted permission level (read or write)
 *   - how many other peers are currently in the room
 *
 * Wire format: `[MESSAGE_SESSION (2)] [JSON-encoded SessionPayload]`.
 * JSON keeps the message extensible without bumping a version.
 */
export const MESSAGE_SESSION = 2;
/** Phase 3.2 (queued) — out-of-band binary part announcements. */
export const MESSAGE_ASSETS = 3;

/**
 * Encode the initial sync-step-1 message a server sends to a newly-
 * connected peer. The peer's response (sync-step-2 / sync-update)
 * carries any state they had locally; we apply that to our Y.Doc and
 * broadcast a sync-step-2 of our own (the current authoritative state).
 */
export function encodeSyncStep1(ydoc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return encoding.toUint8Array(encoder);
}

/** Encode a sync-step-2 (full state) to send to a peer. */
export function encodeSyncStep2(ydoc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(encoder, ydoc);
  return encoding.toUint8Array(encoder);
}

/** Encode a sync-update message for a Y update payload. */
export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * Wrap a raw awareness update (from `encodeAwarenessUpdate`) in the
 * message envelope.
 */
export function encodeAwarenessMessage(rawAwarenessUpdate: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, rawAwarenessUpdate);
  return encoding.toUint8Array(encoder);
}

/**
 * Information the server tells a peer right after they join a room.
 * The peer's editor uses this to decide whether to seed
 * `initialDocument` (only if the room was empty) and whether the
 * peer has write permission.
 */
export interface SessionPayload {
  /** True when the Y.Doc was empty (no body, no meta, no parts) at
   *  the moment this peer joined. Only one peer per fresh room sees
   *  this set — subsequent joiners see `false`. Use it to gate any
   *  initialDocument seeding logic to avoid two clients seeding
   *  divergent state in the same room. */
  isEmpty: boolean;
  /** Whether the server will accept Y sync-update messages from this
   *  peer. False for read-only peers — their awareness still flows
   *  but document mutations are dropped. */
  isWritable: boolean;
  /** Other peers currently in the room (excluding this one). */
  peerCount: number;
}

/** Encode a session message to send to a freshly-joined peer. */
export function encodeSessionMessage(payload: SessionPayload): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SESSION);
  encoding.writeVarString(encoder, JSON.stringify(payload));
  return encoding.toUint8Array(encoder);
}

/** Decode a session message (called by the client). */
export function decodeSessionMessage(decoder: decoding.Decoder): SessionPayload {
  const json = decoding.readVarString(decoder);
  return JSON.parse(json) as SessionPayload;
}

export interface DecodedMessage {
  type: number;
  /** Decoder positioned at the start of the type-specific payload. */
  decoder: decoding.Decoder;
}

/**
 * Read the message-type tag from an incoming buffer; returns the
 * decoder positioned at the payload start.
 */
export function decodeMessageHeader(data: Uint8Array): DecodedMessage {
  const decoder = decoding.createDecoder(data);
  const type = decoding.readVarUint(decoder);
  return { type, decoder };
}

/**
 * Apply an incoming sync message to the room's Y.Doc. Returns the
 * sync-step-2 reply if one is needed (when the incoming message was a
 * sync-step-1), or `null` otherwise. The reply is wrapped in a full
 * message envelope ready to send back to the originating peer.
 *
 * This is a thin shim over `syncProtocol.readSyncMessage` so callers
 * don't have to wrangle encoders / decoders directly.
 */
export function readSyncMessage(
  ydoc: Y.Doc,
  origin: unknown,
  decoder: decoding.Decoder,
): Uint8Array | null {
  const reply = encoding.createEncoder();
  encoding.writeVarUint(reply, MESSAGE_SYNC);
  // readSyncMessage's return is the sub-message-type tag (sync-step
  // 1/2/update). We don't act on it directly — the side effect is
  // applying the incoming message to `ydoc` and (for sync-step-1)
  // writing a sync-step-2 reply into `reply`.
  syncProtocol.readSyncMessage(decoder, reply, ydoc, origin);
  // If readSyncMessage wrote any content beyond the type tag, return
  // it. Otherwise null.
  const len = encoding.length(reply);
  if (len > 1) {
    return encoding.toUint8Array(reply);
  }
  return null;
}
