// Header / footer references carried by a section.

export interface HeaderFooterRef {
  type: "default" | "first" | "even";
  /** Internal id pointing into `SobreeDocument.rawParts` /
   *  `relationships`. We store the header/footer body itself as a
   *  `Block[]` keyed in a side table at the SobreeDocument level. */
  partId: string;
}
