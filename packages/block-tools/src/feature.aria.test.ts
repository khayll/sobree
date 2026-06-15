import { afterEach, describe, expect, it } from "vitest";
import { buildChangeTypeButton, openChangeTypePopover } from "./tools/changeType";
import { buildTextToolsHtml } from "./tools/text";

describe("ARIA: text tools markup", () => {
  it("toolbar mark buttons carry aria-label and aria-pressed", () => {
    const host = document.createElement("div");
    host.innerHTML = buildTextToolsHtml();
    const buttons = host.querySelectorAll<HTMLButtonElement>('button[data-action="wrap"]');
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.getAttribute("aria-label")).toBeTruthy();
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("the marks group is `role=group` with a label", () => {
    const host = document.createElement("div");
    host.innerHTML = buildTextToolsHtml();
    const grp = host.querySelector('[data-group="marks"]');
    expect(grp?.getAttribute("role")).toBe("group");
    expect(grp?.getAttribute("aria-label")).toBeTruthy();
  });

  it("colour inputs have aria-label", () => {
    const host = document.createElement("div");
    host.innerHTML = buildTextToolsHtml();
    const colour = host.querySelector('input[data-role="color"]');
    const highlight = host.querySelector('input[data-role="highlight"]');
    expect(colour?.getAttribute("aria-label")).toBeTruthy();
    expect(highlight?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("ARIA: change-block trigger", () => {
  it("carries aria-haspopup=menu and aria-expanded=false initially", () => {
    const host = document.createElement("div");
    host.innerHTML = buildChangeTypeButton(1);
    const btn = host.querySelector<HTMLButtonElement>(".tb-change-btn");
    expect(btn?.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    expect(btn?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("ARIA: change-type popover", () => {
  const cleanup: (() => void)[] = [];

  afterEach(() => {
    for (const c of cleanup.splice(0)) c();
  });

  function openMenu() {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    cleanup.push(() => trigger.remove());
    const close = openChangeTypePopover(
      trigger,
      // Minimal context — change-type's popover only inspects `refs.length`
      // and `editor` for command dispatch. The buttons it renders are
      // pure markup, which is what these tests check.
      {
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub
        editor: { commands: { execute: () => {} } } as any,
        target: {} as never,
        refs: [{ id: "x", version: 0 }],
      },
      () => {},
    );
    cleanup.push(close);
    return document.querySelector(".sobree-change-popover") as HTMLElement;
  }

  it("popover has role=menu + aria-label", () => {
    const popover = openMenu();
    expect(popover.getAttribute("role")).toBe("menu");
    expect(popover.getAttribute("aria-label")).toBeTruthy();
  });

  it("every action button has a menu role", () => {
    const popover = openMenu();
    const items = popover.querySelectorAll("button[data-target-kind]");
    expect(items.length).toBeGreaterThan(0);
    // Convert/list items use `menuitemradio` (so the current kind can be
    // checked); structural ops (table, section break) stay `menuitem`.
    for (const item of items) {
      const role = item.getAttribute("role");
      expect(["menuitem", "menuitemradio"]).toContain(role);
    }
  });
});
