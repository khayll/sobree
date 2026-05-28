/**
 * Read the OS/2 table's `fsType` field from a TrueType / OpenType font.
 * The field encodes the font foundry's embedding licence — applications
 * that embed must check it. See OpenType spec, OS/2 table § "fsType":
 *   https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fst
 *
 * Bits (mask with 0x000F for the licence triplet — they're mutually
 * exclusive in practice):
 *   0x0000  Installable embedding allowed. ← happy path.
 *   0x0002  Restricted licence — must NOT be embedded.
 *   0x0004  Preview & Print — embed for view/print only, no editing.
 *   0x0008  Editable — embed and allow modifications.
 *   0x0100  No subsetting — must embed the full face.
 *   0x0200  Bitmap embedding only.
 *
 * `readFsType` returns `null` on parse failure (corrupt header, missing
 * OS/2 table, truncated input). Callers treat `null` as "unknown
 * licence — don't embed unless explicitly forced."
 */

export type EmbedMode = "installable" | "preview" | "editable" | "restricted";

export interface FsTypeReport {
  allowed: boolean;
  mode: EmbedMode;
  noSubset: boolean;
  bitmapOnly: boolean;
  /** Raw fsType field, for callers that want the bits. */
  raw: number;
}

/** Walk the table directory and return `OS/2.fsType`, or null on failure. */
export function readFsType(font: Uint8Array): number | null {
  if (font.length < 12) return null;
  const view = new DataView(
    font.buffer,
    font.byteOffset,
    font.byteLength,
  );
  // Offset 0: sfnt version (uint32). Valid: 0x00010000 (TrueType),
  // 0x4F54544F = "OTTO" (CFF/OpenType). Reject anything else.
  const sfnt = view.getUint32(0);
  if (sfnt !== 0x00010000 && sfnt !== 0x4f54544f) return null;
  const numTables = view.getUint16(4);
  // Each table directory entry is 16 bytes. Header is 12 bytes.
  const dirEnd = 12 + numTables * 16;
  if (font.length < dirEnd) return null;

  const OS2_TAG = 0x4f532f32; // "OS/2"
  let os2Offset = -1;
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16;
    const tag = view.getUint32(entry);
    if (tag === OS2_TAG) {
      os2Offset = view.getUint32(entry + 8); // offset
      break;
    }
  }
  if (os2Offset < 0) return null;
  // OS/2 layout: version(uint16) at 0, xAvgCharWidth(int16) at 2,
  //   usWeightClass(uint16) at 4, usWidthClass(uint16) at 6,
  //   fsType(uint16) at 8.
  if (font.length < os2Offset + 10) return null;
  return view.getUint16(os2Offset + 8);
}

/**
 * Interpret an `fsType` value into a structured embedding decision.
 * Defensive on `null` input (corrupt font) — reports as restricted so
 * callers fail closed.
 */
export function canEmbed(fsType: number | null): FsTypeReport {
  if (fsType === null) {
    return {
      allowed: false,
      mode: "restricted",
      noSubset: false,
      bitmapOnly: false,
      raw: 0,
    };
  }
  const licence = fsType & 0x000f;
  const noSubset = (fsType & 0x0100) !== 0;
  const bitmapOnly = (fsType & 0x0200) !== 0;

  // Bits 0x0002, 0x0004, 0x0008 are mutually exclusive in practice;
  // when more than one is set, prefer the most restrictive.
  let mode: EmbedMode;
  if ((licence & 0x0002) !== 0) mode = "restricted";
  else if ((licence & 0x0004) !== 0) mode = "preview";
  else if ((licence & 0x0008) !== 0) mode = "editable";
  else mode = "installable";

  return {
    allowed: mode !== "restricted",
    mode,
    noSubset,
    bitmapOnly,
    raw: fsType,
  };
}
