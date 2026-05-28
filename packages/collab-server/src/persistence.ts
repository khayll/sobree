/**
 * Persistence backends for the collab-server.
 *
 * Sobree ships a filesystem backend that's adequate for self-hosted
 * deployments. Production deployments at scale should write a custom
 * backend against S3 / R2 / Postgres / Redis — the interface is small.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

export interface Persistence {
  /** Load the latest Y.Doc snapshot for a room, or `null` if none exists. */
  load(roomId: string): Promise<Uint8Array | null>;
  /** Persist a Y.Doc snapshot for a room. Atomic from the perspective
   *  of subsequent `load()` calls. */
  save(roomId: string, update: Uint8Array): Promise<void>;
  /** Optional — delete a room's persisted state. */
  delete?(roomId: string): Promise<void>;
}

export interface FilesystemPersistenceOptions {
  /** Directory under which room snapshots are stored. Created on first save. */
  dir: string;
}

/**
 * Filesystem persistence: one file per room, atomic-rename writes.
 *
 * Room id is sanitized to a safe filename. For deeply nested room ids
 * (e.g. `org/team/doc-1`), forward slashes become directory
 * separators so the on-disk layout matches the logical hierarchy.
 */
export function filesystemPersistence(
  opts: FilesystemPersistenceOptions,
): Persistence {
  const root = opts.dir;
  return {
    async load(roomId) {
      const path = filePath(root, roomId);
      try {
        const buf = await fs.readFile(path);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "ENOENT"
        ) {
          return null;
        }
        throw err;
      }
    },
    async save(roomId, update) {
      const path = filePath(root, roomId);
      await fs.mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
      await fs.writeFile(tmp, update);
      await fs.rename(tmp, path);
    },
    async delete(roomId) {
      const path = filePath(root, roomId);
      try {
        await fs.unlink(path);
      } catch (err) {
        if (
          !(
            typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err as { code: string }).code === "ENOENT"
          )
        ) {
          throw err;
        }
      }
    },
  };
}

function filePath(root: string, roomId: string): string {
  // Sanitize: replace control / unsafe chars with "_", collapse `..`
  // segments. Forward slashes become directory separators.
  const segments = roomId
    .split("/")
    .map((s) =>
      s
        .replace(/[\x00-\x1f]/g, "_")
        .replace(/^\.+$/, "_")
        .replace(/[<>:"\\|?*]/g, "_"),
    )
    .filter((s) => s.length > 0);
  if (segments.length === 0) throw new Error(`invalid roomId: ${JSON.stringify(roomId)}`);
  return `${join(root, ...segments)}.ydoc`;
}

/**
 * In-memory persistence (tests / ephemeral deployments). State is
 * lost on process restart but the API matches the disk backend.
 */
export function memoryPersistence(): Persistence {
  const store = new Map<string, Uint8Array>();
  return {
    async load(roomId) {
      return store.get(roomId) ?? null;
    },
    async save(roomId, update) {
      // Copy so callers can mutate the original without affecting us.
      store.set(roomId, new Uint8Array(update));
    },
    async delete(roomId) {
      store.delete(roomId);
    },
  };
}
