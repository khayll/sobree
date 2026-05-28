import * as Y from "yjs";

/**
 * Two Y.Docs wired together in-memory — useful for tests and demos.
 *
 * Constructs a pair: `{ a: Y.Doc, b: Y.Doc }`. Updates applied to `a`
 * automatically replicate to `b` and vice versa. No network involved.
 *
 * The returned `destroy()` removes both observers — the Y.Docs survive
 * for the caller to inspect / use. `.destroy()` on the docs themselves
 * still works the usual way.
 */
export function loopback(): {
  a: Y.Doc;
  b: Y.Doc;
  destroy(): void;
} {
  const a = new Y.Doc();
  const b = new Y.Doc();

  const ab = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    Y.applyUpdate(b, update, "remote");
  };
  const ba = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    Y.applyUpdate(a, update, "remote");
  };
  a.on("update", ab);
  b.on("update", ba);

  return {
    a,
    b,
    destroy(): void {
      a.off("update", ab);
      b.off("update", ba);
    },
  };
}
