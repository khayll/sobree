import { describe, expect, it } from "vitest";
import { BlockRegistry } from "./blockRegistry";

describe("BlockRegistry", () => {
  it("allocates sequential ids on reset", () => {
    const r = new BlockRegistry();
    r.reset(3);
    expect(r.length()).toBe(3);
    expect(r.refAt(0).id).toBe("b1");
    expect(r.refAt(1).id).toBe("b2");
    expect(r.refAt(2).id).toBe("b3");
    for (let i = 0; i < 3; i++) expect(r.refAt(i).version).toBe(0);
    expect(r.documentVersion()).toBe(0);
  });

  it("bumps per-block version and doc version on bump()", () => {
    const r = new BlockRegistry();
    r.reset(2);
    const a = r.bump(0);
    expect(a.version).toBe(1);
    expect(r.refAt(0).version).toBe(1);
    expect(r.refAt(1).version).toBe(0);
    expect(r.documentVersion()).toBe(1);
    r.bump(1);
    expect(r.documentVersion()).toBe(2);
  });

  it("insert shifts subsequent entries right and assigns a fresh id", () => {
    const r = new BlockRegistry();
    r.reset(2);
    const before = [r.refAt(0).id, r.refAt(1).id];
    const ref = r.insert(1);
    expect(r.length()).toBe(3);
    expect(ref.id).toBe("b3");
    expect(r.refAt(0).id).toBe(before[0]);
    expect(r.refAt(1).id).toBe(ref.id);
    expect(r.refAt(2).id).toBe(before[1]);
    expect(ref.version).toBe(0);
  });

  it("remove shifts entries left and frees the id from `has()`", () => {
    const r = new BlockRegistry();
    r.reset(3);
    const removedId = r.refAt(1).id;
    r.remove(1);
    expect(r.length()).toBe(2);
    expect(r.has(removedId)).toBe(false);
    expect(r.refById(removedId)).toBeNull();
  });

  it("ids are never reused after removal", () => {
    const r = new BlockRegistry();
    r.reset(2);
    const id0 = r.refAt(0).id;
    r.remove(0);
    r.insert(0);
    expect(r.refAt(0).id).not.toBe(id0);
  });

  it("indexOf reflects current positions after shifts", () => {
    const r = new BlockRegistry();
    r.reset(3);
    const id0 = r.refAt(0).id;
    const id2 = r.refAt(2).id;
    expect(r.indexOf(id0)).toBe(0);
    expect(r.indexOf(id2)).toBe(2);
    r.remove(0);
    expect(r.indexOf(id0)).toBe(-1);
    expect(r.indexOf(id2)).toBe(1);
  });

  it("refById returns the current version even after bumps", () => {
    const r = new BlockRegistry();
    r.reset(1);
    const id = r.refAt(0).id;
    r.bump(0);
    r.bump(0);
    expect(r.refById(id)?.version).toBe(2);
  });

  it("bumpChanged bumps only the flagged blocks and doc version once", () => {
    const r = new BlockRegistry();
    r.reset(3);
    r.bumpChanged([false, true, false]);
    expect(r.refAt(0).version).toBe(0);
    expect(r.refAt(1).version).toBe(1);
    expect(r.refAt(2).version).toBe(0);
    expect(r.documentVersion()).toBe(1);
  });

  it("bumpChanged does nothing when all flags are false", () => {
    const r = new BlockRegistry();
    r.reset(3);
    r.bumpChanged([false, false, false]);
    expect(r.documentVersion()).toBe(0);
  });

  it("refAt throws on out-of-range", () => {
    const r = new BlockRegistry();
    r.reset(1);
    expect(() => r.refAt(5)).toThrow();
  });
});
