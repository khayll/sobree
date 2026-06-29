import { describe, expect, it } from "vitest";
import { parseSettingsXml } from "./settings";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

describe("parseSettingsXml — noColumnBalance", () => {
  it("reads <w:noColumnBalance/> from <w:compat>", () => {
    const xml = `<?xml version="1.0"?><w:settings xmlns:w="${W}">
      <w:compat><w:noColumnBalance/></w:compat>
    </w:settings>`;
    expect(parseSettingsXml(xml).noColumnBalance).toBe(true);
  });

  it("leaves noColumnBalance unset when absent", () => {
    const xml = `<?xml version="1.0"?><w:settings xmlns:w="${W}"><w:compat/></w:settings>`;
    expect(parseSettingsXml(xml).noColumnBalance).toBeUndefined();
  });
});
