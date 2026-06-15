import type * as Y from "yjs";
import type { CollabHandle, IdentityOptions } from "./types";

export interface WebRTCProviderOptions extends IdentityOptions {
  /** Room name. Each room is one Y.Doc shared across peers. */
  room: string;
  /** Pre-shared room password. Optional but recommended for any
   *  non-public collaboration. */
  password?: string;
  /** Custom signaling servers. Defaults to the public servers shipped
   *  with `y-webrtc`; for production set up your own. */
  signaling?: string[];
}

/**
 * Attach a `y-webrtc` provider — peer-to-peer collaboration, with a
 * tiny signaling server (or shared public ones) used only for initial
 * peer discovery.
 *
 * Requires `y-webrtc` as a peer dep — install it explicitly:
 *
 * ```sh
 * pnpm add y-webrtc
 * ```
 *
 * Best for small (≤4 peer) ad-hoc collaboration where you don't want
 * to host a relay server. For more peers / persistence /
 * authoritative state, use `attachWebsocketProvider` against
 * `@sobree/collab-server` (Phase 3).
 */
export async function attachWebRTCProvider(
  ydoc: Y.Doc,
  opts: WebRTCProviderOptions,
): Promise<CollabHandle> {
  const ywebrtc = await loadYWebRTC();
  const providerOpts: Record<string, unknown> = {};
  if (opts.password) providerOpts.password = opts.password;
  if (opts.signaling) providerOpts.signaling = opts.signaling;

  const provider = new ywebrtc.WebrtcProvider(opts.room, ydoc, providerOpts);

  if (opts.name || opts.color || opts.userId) {
    provider.awareness.setLocalStateField("user", {
      id: opts.userId ?? randomId(),
      name: opts.name ?? "Anonymous",
      color: opts.color ?? "#888",
    });
  }

  // y-webrtc has no canonical 'synced' event (peer-to-peer; no
  // single source of truth). Resolve once the first peer connects,
  // or after a short timeout if we're alone in the room.
  const synced = new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    provider.on("peers", ({ added }: { added: unknown[] }) => {
      if (added.length > 0) finish();
    });
    setTimeout(finish, 1000);
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

async function loadYWebRTC(): Promise<typeof import("y-webrtc")> {
  try {
    return await import("y-webrtc");
  } catch (err) {
    throw new Error(
      "y-webrtc is not installed. Run `pnpm add y-webrtc` (or `npm install y-webrtc`) " +
        "and import this module again. See https://github.com/yjs/y-webrtc.",
      { cause: err },
    );
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
