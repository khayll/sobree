import { describe, expect, it } from "vitest";
import { resolveShadingColor } from "./shadingColor";

describe("resolveShadingColor", () => {
  it("returns undefined for no shading", () => {
    expect(resolveShadingColor(undefined)).toBeUndefined();
  });

  it("clear → the fill; auto fill paints nothing", () => {
    expect(resolveShadingColor({ pattern: "clear", fill: "#C6EFCE" })).toBe("#C6EFCE");
    expect(resolveShadingColor({ pattern: "clear", fill: "auto" })).toBeUndefined();
  });

  it("pct40 auto auto → ~40% grey (composite of black over white)", () => {
    // 0xff·0.6 + 0x00·0.4 = 153 = 0x99 on every channel.
    expect(resolveShadingColor({ pattern: "pct40", fill: "auto", color: "auto" })).toBe("#999999");
  });

  it("pctN composites the foreground over the fill", () => {
    // 50% of red over white → #ff8080.
    expect(resolveShadingColor({ pattern: "pct50", fill: "#FFFFFF", color: "#FF0000" })).toBe(
      "#ff8080",
    );
  });

  it("solid shows the fill (not text-black)", () => {
    expect(resolveShadingColor({ pattern: "solid", fill: "#00FF00" })).toBe("#00FF00");
    // solid with no fill falls to the foreground, then text-black.
    expect(resolveShadingColor({ pattern: "solid", fill: "auto", color: "#123456" })).toBe(
      "#123456",
    );
    expect(resolveShadingColor({ pattern: "solid", fill: "auto" })).toBe("#000000");
  });

  it("an unrecognised texture pattern shows only an explicit fill", () => {
    expect(resolveShadingColor({ pattern: "horzStripe", fill: "#EEEEEE" })).toBe("#EEEEEE");
    expect(
      resolveShadingColor({ pattern: "horzStripe", fill: "auto", color: "auto" }),
    ).toBeUndefined();
  });
});
