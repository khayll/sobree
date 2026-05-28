import type { BlockRef } from "../../doc/api";

/**
 * Per-block identity + version tracking.
 *
 * The Editor owns one BlockRegistry for its lifetime. Every block in the
 * current body has a stable `id` (sequential strings like `"b1"`, `"b2"`)
 * and a `version` that bumps on every modification. Indices shift as
 * blocks are inserted / removed, but `id` doesn't.
 *
 * The whole registry is reset on `setDocument` / `openDocx`. It is NOT
 * persisted — versions are a runtime-only contract.
 *
 * Pure data + arithmetic; no DOM access.
 */
export interface BlockRegistryOptions {
  /**
   * Prefix for newly-allocated ids. Default `"b"` produces `b1`, `b2`,
   * … — fine for single-peer use. Phase 1b+ embedders pass a
   * peer-unique prefix (e.g. `${ydoc.clientID.toString(36)}_`) so two
   * peers don't both mint `b5` for different blocks.
   */
  idPrefix?: string;
}

export class BlockRegistry {
  /** Per-block state, parallel to the body array. */
  private entries: Entry[] = [];
  /** Fast lookup by id. Points at the same objects as `entries`. */
  private byId: Map<string, Entry> = new Map();
  /** Next numeric suffix to allocate. Monotonic across `reset()` calls
   *  so an id minted before a reset never collides with one minted
   *  after. */
  private nextNum = 1;
  /** String prepended to every newly-minted id. Constant for the
   *  lifetime of the registry. */
  private readonly idPrefix: string;
  /** Document-wide monotonic counter — bumps on any modification. */
  private docVersion = 0;

  constructor(opts: BlockRegistryOptions = {}) {
    this.idPrefix = opts.idPrefix ?? "b";
  }

  /** Replace the registry for a fresh document of `blockCount` blocks. */
  reset(blockCount: number): void {
    this.entries = [];
    this.byId.clear();
    for (let i = 0; i < blockCount; i++) this.allocEntry();
    this.docVersion = 0;
  }

  /**
   * Replace the registry from an explicit id list — used when adopting
   * an existing Y.Doc's body (Phase 1b: peer joining an active room).
   * The supplied ids are kept verbatim; future inserts continue to use
   * the registry's own `idPrefix` so peer-minted ids stay distinct from
   * adopted-foreign ids.
   *
   * `nextNum` is advanced past any local-prefix collisions found in
   * the adopted set, so a future local insert can't shadow an adopted
   * id.
   */
  adoptIds(ids: readonly string[]): void {
    this.entries = [];
    this.byId.clear();
    for (const id of ids) {
      const e: Entry = { id, version: 0 };
      this.entries.push(e);
      this.byId.set(id, e);
      // If this id matches our local prefix, advance nextNum so we
      // don't re-mint it.
      if (id.startsWith(this.idPrefix)) {
        const suffix = id.slice(this.idPrefix.length);
        const n = Number.parseInt(suffix, 10);
        if (Number.isFinite(n) && n >= this.nextNum) this.nextNum = n + 1;
      }
    }
    this.docVersion = 0;
  }

  /** Number of blocks currently tracked. */
  length(): number {
    return this.entries.length;
  }

  /** Current document counter (monotonic across all edits). */
  documentVersion(): number {
    return this.docVersion;
  }

  /** Ref for the block at `index`. Throws on out-of-range. */
  refAt(index: number): BlockRef {
    const e = this.entries[index];
    if (!e) throw new Error(`BlockRegistry: index ${index} out of range`);
    return { id: e.id, version: e.version };
  }

  /** Ref by id, or `null` if the id isn't live. */
  refById(id: string): BlockRef | null {
    const e = this.byId.get(id);
    return e ? { id: e.id, version: e.version } : null;
  }

  /** Current body-index of the given id, or `-1` if not found. */
  indexOf(id: string): number {
    const e = this.byId.get(id);
    if (!e) return -1;
    return this.entries.indexOf(e);
  }

  /** Whether `id` is currently live (not deleted). */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Bump the version of the block at `index`. Bumps doc version too.
   * Returns the new ref for the caller to pass back in results.
   */
  bump(index: number): BlockRef {
    const e = this.entries[index];
    if (!e) throw new Error(`BlockRegistry: bump out of range (${index})`);
    e.version += 1;
    this.docVersion += 1;
    return { id: e.id, version: e.version };
  }

  /**
   * Insert a fresh entry at `index`, shifting subsequent entries right.
   * The new entry starts at version 0. Bumps doc version.
   */
  insert(index: number): BlockRef {
    const entry = this.newEntry();
    const clamped = Math.max(0, Math.min(index, this.entries.length));
    this.entries.splice(clamped, 0, entry);
    this.byId.set(entry.id, entry);
    this.docVersion += 1;
    return { id: entry.id, version: entry.version };
  }

  /**
   * Remove the entry at `index`, shifting subsequent entries left.
   * Bumps doc version.
   */
  remove(index: number): void {
    const e = this.entries[index];
    if (!e) return;
    this.entries.splice(index, 1);
    this.byId.delete(e.id);
    this.docVersion += 1;
  }

  /**
   * Replace everything at once — used by `syncFromDom` when the rebuild
   * preserves identity but content may have changed per-block. Pass a
   * parallel array of "did this block change" booleans; true entries
   * bump; the registry itself doesn't know what changed.
   *
   * Callers that know nothing about diffs should call `.reset(n)` instead.
   */
  bumpChanged(changed: readonly boolean[]): void {
    let anyBumped = false;
    for (let i = 0; i < changed.length && i < this.entries.length; i++) {
      if (changed[i]) {
        const e = this.entries[i];
        if (!e) continue;
        e.version += 1;
        anyBumped = true;
      }
    }
    if (anyBumped) this.docVersion += 1;
  }

  // === internals ===

  private allocEntry(): void {
    const e = this.newEntry();
    this.entries.push(e);
    this.byId.set(e.id, e);
  }

  private newEntry(): Entry {
    return { id: `${this.idPrefix}${this.nextNum++}`, version: 0 };
  }
}

interface Entry {
  id: string;
  version: number;
}
