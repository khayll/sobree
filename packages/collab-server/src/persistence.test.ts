import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesystemPersistence, memoryPersistence } from "./persistence";

describe("memoryPersistence", () => {
  it("load returns null when nothing saved", async () => {
    const p = memoryPersistence();
    expect(await p.load("nope")).toBeNull();
  });

  it("save then load round-trips", async () => {
    const p = memoryPersistence();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await p.save("room1", bytes);
    const loaded = await p.load("room1");
    expect(loaded).toEqual(bytes);
  });

  it("save copies the input (defensive)", async () => {
    const p = memoryPersistence();
    const bytes = new Uint8Array([1, 2, 3]);
    await p.save("r", bytes);
    bytes[0] = 99;
    const loaded = await p.load("r");
    expect(loaded?.[0]).toBe(1);
  });

  it("delete drops the entry", async () => {
    const p = memoryPersistence();
    await p.save("r", new Uint8Array([1]));
    await p.delete?.("r");
    expect(await p.load("r")).toBeNull();
  });
});

describe("filesystemPersistence", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "sobree-fs-pers-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("save creates the file; load returns its contents", async () => {
    const p = filesystemPersistence({ dir });
    await p.save("room1", new Uint8Array([1, 2, 3]));
    expect(await p.load("room1")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("load returns null for nonexistent room", async () => {
    const p = filesystemPersistence({ dir });
    expect(await p.load("ghost")).toBeNull();
  });

  it("save is atomic — overwrites cleanly", async () => {
    const p = filesystemPersistence({ dir });
    await p.save("r", new Uint8Array([1]));
    await p.save("r", new Uint8Array([2, 3, 4]));
    expect(await p.load("r")).toEqual(new Uint8Array([2, 3, 4]));
  });

  it("supports nested room ids (slashes → directories)", async () => {
    const p = filesystemPersistence({ dir });
    await p.save("org/team/doc-1", new Uint8Array([7]));
    expect(await p.load("org/team/doc-1")).toEqual(new Uint8Array([7]));
  });

  it("sanitizes unsafe path characters", async () => {
    const p = filesystemPersistence({ dir });
    // Backslashes, colons, etc. would otherwise produce invalid paths
    // on some filesystems.
    await p.save("room:with*unsafe<chars>", new Uint8Array([1]));
    expect(await p.load("room:with*unsafe<chars>")).toEqual(new Uint8Array([1]));
  });

  it("rejects empty roomId", async () => {
    const p = filesystemPersistence({ dir });
    await expect(p.save("", new Uint8Array([1]))).rejects.toThrow(/invalid roomId/);
  });

  it("delete removes the file", async () => {
    const p = filesystemPersistence({ dir });
    await p.save("r", new Uint8Array([1]));
    await p.delete?.("r");
    expect(await p.load("r")).toBeNull();
  });
});
