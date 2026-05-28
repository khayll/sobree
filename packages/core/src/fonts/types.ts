/**
 * Font-table type definitions, lifted out of `doc/types.ts` so the
 * fonts module owns its own AST shapes. Re-exported from
 * `doc/types.ts` for backwards compat — existing consumers keep
 * working unchanged.
 */

/**
 * One entry in the document's font table — mirrors `<w:font>` in
 * OOXML. Most fields are substitution hints used when the named font
 * isn't installed on the reader's machine; `embed` carries pointers
 * to actual font bytes stored under `rawParts`.
 */
export interface FontDeclaration {
  /** `<w:font w:name="...">` — the font family this entry describes. */
  name: string;
  altName?: string;
  /** 10-byte PANOSE classification, hex-encoded. */
  panose?: string;
  /** Character set, hex (default "00"). */
  charset?: string;
  family?: "auto" | "decorative" | "modern" | "roman" | "script" | "swiss";
  pitch?: "default" | "fixed" | "variable";
  /** Unicode/codepage subset bitmasks — mirrors `<w:sig>`. */
  sig?: {
    usb0: string;
    usb1: string;
    usb2: string;
    usb3: string;
    csb0: string;
    csb1: string;
  };
  notTrueType?: boolean;
  /** Embedded faces. Optional — most declarations are just name + panose. */
  embed?: {
    regular?: FontEmbedRef;
    bold?: FontEmbedRef;
    italic?: FontEmbedRef;
    boldItalic?: FontEmbedRef;
  };
}

export interface FontEmbedRef {
  /** ZIP path of the font bytes (key into `SobreeDocument.rawParts`). */
  partPath: string;
  /**
   * GUID used for ODTTF XOR-obfuscation of the first 32 bytes. Absent
   * means the part is a raw TTF/OTF (no obfuscation). When writing
   * `.docx`, a fresh GUID is generated per embed.
   */
  fontKey?: string;
  /** Round-trip flag — true if the on-disk file is already a subset. */
  subsetted?: boolean;
}
