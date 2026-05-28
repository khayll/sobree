/**
 * Register embedded fonts as `@font-face` rules so the renderer's
 * `font-family: <name>` actually picks them up. Without this, embedded
 * faces silently fall back to the OS-installed font of the same name
 * (or the next item in the CSS font-stack), which defeats the point of
 * embedding.
 *
 * One registry per Editor — owns its `<style>` tag and the blob URLs
 * it created, so destroy() cleans up after itself.
 */

import type { FontDeclaration } from "./types";
import { deobfuscate, isUnobfuscated } from "./odttf";

export class FontFaceRegistry {
  private readonly styleEl: HTMLStyleElement;
  /** Mostly for cleanup — every blob URL we minted needs revoking. */
  private blobUrls: string[] = [];
  /** Last-applied snapshot — skip re-registration when nothing changed. */
  private lastSerialised: string | null = null;

  constructor() {
    this.styleEl = document.createElement("style");
    this.styleEl.dataset.sobreeFontFaces = "";
    document.head.appendChild(this.styleEl);
  }

  /**
   * Sync the registry to the current document's fonts. Idempotent —
   * if the font list hasn't changed since the last call, no work
   * happens (no blob revocation, no DOM churn).
   *
   * Bails out (no-op) when the runtime doesn't expose
   * `URL.createObjectURL` — typically jsdom in tests, where the
   * registry isn't observable anyway.
   */
  sync(fonts: readonly FontDeclaration[], rawParts: Record<string, Uint8Array>): void {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return;
    }
    // Defensive: some doc-construction paths (Y.Doc projections, partial
    // setDocument calls from headless agents) hand us a doc without
    // `fonts` populated. The type contract says required, but the
    // runtime cost of normalising here is one boolean check vs. a hard
    // crash inside `serialiseKey` on every such doc.
    const fontList = fonts ?? [];
    const parts = rawParts ?? {};
    const key = serialiseKey(fontList);
    if (key === this.lastSerialised) return;
    this.lastSerialised = key;

    // Revoke old blob URLs before minting new ones.
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];

    const rules: string[] = [];
    for (const decl of fontList) {
      if (!decl.embed) continue;
      const slots: Array<["regular" | "bold" | "italic" | "boldItalic", { weight: 400 | 700; italic: boolean }]> = [
        ["regular", { weight: 400, italic: false }],
        ["bold", { weight: 700, italic: false }],
        ["italic", { weight: 400, italic: true }],
        ["boldItalic", { weight: 700, italic: true }],
      ];
      for (const [key, descriptor] of slots) {
        const ref = decl.embed[key];
        if (!ref) continue;
        const obfuscated = parts[ref.partPath];
        if (!obfuscated) continue;
        const bytes = isUnobfuscated(ref.fontKey)
          ? obfuscated
          : deobfuscate(obfuscated, ref.fontKey ?? "");
        const blob = new Blob([new Uint8Array(bytes)], {
          type: "application/font-sfnt",
        });
        const url = URL.createObjectURL(blob);
        this.blobUrls.push(url);
        rules.push(buildFontFaceRule(decl.name, url, descriptor));
      }
    }
    this.styleEl.textContent = rules.join("\n");
  }

  destroy(): void {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      for (const url of this.blobUrls) URL.revokeObjectURL(url);
    }
    this.blobUrls = [];
    this.styleEl.remove();
  }
}

function buildFontFaceRule(
  name: string,
  url: string,
  descriptor: { weight: 400 | 700; italic: boolean },
): string {
  return `@font-face {
  font-family: ${escapeFontFamily(name)};
  font-weight: ${descriptor.weight};
  font-style: ${descriptor.italic ? "italic" : "normal"};
  src: url(${url});
}`;
}

/** Quote font-family names that contain spaces, per CSS spec. */
function escapeFontFamily(name: string): string {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}

function serialiseKey(fonts: readonly FontDeclaration[]): string {
  // Compact key — name + embed paths. We don't include the byte
  // contents because if the bytes change without the partPath
  // changing, the consumer either re-allocates a new partPath
  // (embedFont always does) or knows what they're doing.
  return JSON.stringify(
    fonts.map((f) => ({
      n: f.name,
      e: f.embed
        ? {
            r: f.embed.regular?.partPath,
            b: f.embed.bold?.partPath,
            i: f.embed.italic?.partPath,
            bi: f.embed.boldItalic?.partPath,
          }
        : undefined,
    })),
  );
}
