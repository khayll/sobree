// Tracked-change markers shared by runs and paragraph marks.

export interface RevisionMark {
  /** `ins` = insertion, `del` = deletion. */
  type: "ins" | "del";
  /** Author name as recorded in the docx (`<w:ins w:author="...">`). */
  author?: string;
  /** ISO-8601 timestamp string from the docx. */
  date?: string;
}
