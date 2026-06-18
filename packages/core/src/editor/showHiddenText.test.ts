import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import { Editor } from "./";

function withHidden() {
  const doc = emptyDocument();
  doc.body = [paragraph([text("visible "), text("secret", { hidden: true })])];
  return doc;
}

describe("setShowHiddenText", () => {
  it("toggles the sobree-show-hidden class on the editor root; off by default", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor(host, { initialDocument: withHidden() });
    try {
      expect(host.classList.contains("sobree-show-hidden")).toBe(false);
      // the hidden run still renders into the DOM (round-trip safe), just hidden by CSS
      expect(host.querySelector(".sobree-hidden")?.textContent).toBe("secret");

      editor.setShowHiddenText(true);
      expect(host.classList.contains("sobree-show-hidden")).toBe(true);
      editor.setShowHiddenText(false);
      expect(host.classList.contains("sobree-show-hidden")).toBe(false);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("the showHiddenText option reveals from construction", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor(host, { initialDocument: withHidden(), showHiddenText: true });
    try {
      expect(host.classList.contains("sobree-show-hidden")).toBe(true);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
