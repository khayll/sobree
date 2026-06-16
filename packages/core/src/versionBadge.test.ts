import { afterEach, describe, expect, it } from "vitest";

import { VERSION } from "./version";
import { mountVersionBadge } from "./versionBadge";

afterEach(() => {
  for (const el of Array.from(document.querySelectorAll(".sobree-version-badge"))) el.remove();
});

describe("mountVersionBadge", () => {
  it("appends a fixed, non-interactive badge showing the core version", () => {
    mountVersionBadge();
    const badge = document.querySelector<HTMLElement>(".sobree-version-badge");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe(`@sobree/core v${VERSION}`);
    expect(badge!.style.position).toBe("fixed");
    expect(badge!.style.pointerEvents).toBe("none");
    expect(badge!.getAttribute("aria-hidden")).toBe("true");
  });

  it("teardown removes the badge", () => {
    const teardown = mountVersionBadge();
    expect(document.querySelector(".sobree-version-badge")).toBeTruthy();
    teardown();
    expect(document.querySelector(".sobree-version-badge")).toBeNull();
  });

  it("VERSION is a non-empty semver-ish string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
