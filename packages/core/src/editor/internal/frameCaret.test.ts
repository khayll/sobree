import { beforeEach, describe, expect, it } from "vitest";
import { caretCharOffset, placeCaretAtOffset } from "./frameCaret";

/** A frame-like root: a contentEditable host with one `<p>`. */
function frameWith(text: string): HTMLElement {
  const frame = document.createElement("div");
  frame.contentEditable = "true";
  frame.tabIndex = 0;
  const p = document.createElement("p");
  p.textContent = text;
  frame.append(p);
  document.body.append(frame);
  return frame;
}

function setCaret(textNode: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("frameCaret", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("captures the caret's character offset within the frame", () => {
    const frame = frameWith("Heading");
    setCaret(frame.querySelector("p")!.firstChild!, 3);
    expect(caretCharOffset(frame, document)).toBe(3);
  });

  it("sums offsets across multiple text nodes", () => {
    const frame = document.createElement("div");
    const p = document.createElement("p");
    p.append(document.createTextNode("ab"));
    const span = document.createElement("span");
    span.textContent = "cd";
    p.append(span);
    frame.append(p);
    document.body.append(frame);
    setCaret(span.firstChild!, 1); // after "abc"
    expect(caretCharOffset(frame, document)).toBe(3);
  });

  it("returns null when the selection is outside the frame", () => {
    const frame = frameWith("x");
    const other = frameWith("y");
    setCaret(other.querySelector("p")!.firstChild!, 1);
    expect(caretCharOffset(frame, document)).toBeNull();
  });

  it("places the caret at the captured offset (round-trip)", () => {
    const frame = frameWith("Heading");
    placeCaretAtOffset(frame, 4, document);
    expect(caretCharOffset(frame, document)).toBe(4);
  });

  it("clamps to the end when the offset runs past shorter text", () => {
    const frame = frameWith("Hi"); // post-undo shrank from a longer string
    placeCaretAtOffset(frame, 12, document);
    expect(caretCharOffset(frame, document)).toBe(2);
  });

  it("is safe on an empty frame", () => {
    const frame = document.createElement("div");
    document.body.append(frame);
    expect(() => placeCaretAtOffset(frame, 5, document)).not.toThrow();
  });
});
