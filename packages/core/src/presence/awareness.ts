/**
 * Minimal awareness interface — a structural subset of
 * `y-protocols/awareness`'s `Awareness` class. We don't depend on
 * `y-protocols` from `@sobree/core` (it's an optional concern); the
 * interface here is structurally compatible so an `Awareness`
 * instance passes typecheck without any glue.
 *
 * The shape:
 *
 *   - `clientID` — the local peer's id (matches `ydoc.clientID`)
 *   - `setLocalState(state | null)` — publish your own state
 *   - `setLocalStateField(field, value)` — patch one field
 *   - `getStates()` — read every peer's state as `Map<clientID, state>`
 *   - `on("change", cb) / off("change", cb)` — subscribe to changes
 */
export interface AwarenessLike {
  readonly clientID: number;
  setLocalState(state: Record<string, unknown> | null): void;
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: "change" | "update", cb: (changes: AwarenessChanges, origin: unknown) => void): void;
  off(event: "change" | "update", cb: (changes: AwarenessChanges, origin: unknown) => void): void;
}

export interface AwarenessChanges {
  added: number[];
  updated: number[];
  removed: number[];
}
