import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";

// In the vitest+jsdom environment, `globalThis.Uint8Array` and the
// Uint8Array produced by jsdom's `TextEncoder` (or Node's) don't share a
// constructor. That trips any library doing `instanceof Uint8Array` on its
// inputs — fflate is one such. The fix: wrap the encoder so its output
// goes through `new globalThis.Uint8Array(...)`, placing the bytes in
// whichever realm tests actually use. Production browsers don't need
// this; it's only for the cross-realm jsdom case.

class RealmTextEncoder {
  readonly encoding = "utf-8";
  private readonly inner = new NodeTextEncoder();

  encode(s: string): Uint8Array {
    const raw = this.inner.encode(s);
    const out = new (globalThis.Uint8Array as Uint8ArrayConstructor)(raw.length);
    out.set(raw);
    return out;
  }

  encodeInto(s: string, dest: Uint8Array): { read: number; written: number } {
    return this.inner.encodeInto(s, dest);
  }
}

Object.defineProperty(globalThis, "TextEncoder", {
  value: RealmTextEncoder,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
  value: NodeTextDecoder,
  configurable: true,
  writable: true,
});
