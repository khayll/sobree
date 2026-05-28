import { describe, expect, it } from "vitest";
import { loopback } from "./loopback";

describe("loopback", () => {
  it("propagates an update from a to b", () => {
    const { a, b, destroy } = loopback();
    try {
      a.getArray("body").insert(0, ["hello"]);
      expect(b.getArray("body").length).toBe(1);
      expect(b.getArray("body").get(0)).toBe("hello");
    } finally {
      destroy();
    }
  });

  it("propagates an update from b to a", () => {
    const { a, b, destroy } = loopback();
    try {
      b.getMap("meta").set("title", "world");
      expect(a.getMap("meta").get("title")).toBe("world");
    } finally {
      destroy();
    }
  });

  it("doesn't loop infinitely (bounded transaction count, ends in sync)", () => {
    const { a, b, destroy } = loopback();
    try {
      let aUpdates = 0;
      let bUpdates = 0;
      a.on("afterTransaction", () => aUpdates++);
      b.on("afterTransaction", () => bUpdates++);
      a.getArray("body").insert(0, ["one"]);
      // Both ends settle: bounded number of transactions, identical
      // state. (Y can fire 1-2 transactions per side depending on
      // batching; the load-bearing assertion is "no runaway loop".)
      expect(aUpdates).toBeLessThanOrEqual(2);
      expect(bUpdates).toBeLessThanOrEqual(2);
      expect(b.getArray("body").get(0)).toBe("one");
    } finally {
      destroy();
    }
  });

  it("destroy stops further propagation", () => {
    const { a, b, destroy } = loopback();
    destroy();
    a.getArray("body").insert(0, ["after-destroy"]);
    expect(b.getArray("body").length).toBe(0);
  });
});
