import { createSobree } from "@sobree/core";
import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

const checkOptions = { allowEmptyTests: false };
const tsconfig = "tsconfig.architecture.json";

const coreSrc = "packages/core/src/**";
const pluginSrcFolders = [
  "packages/block-tools/src/**",
  "packages/keyboard/src/**",
  "packages/review/src/**",
  "packages/zoom-controls/src/**",
] as const;

const publicPackages = [
  "packages/core/src/**",
  "packages/block-tools/src/**",
  "packages/keyboard/src/**",
  "packages/review/src/**",
  "packages/zoom-controls/src/**",
  "packages/collab-providers/src/**",
  "packages/collab-server/src/**",
  "packages/mcp/src/**",
] as const;

const pureCoreZones = [
  {
    name: "document model",
    files: "packages/core/src/doc/**",
    forbidden: [
      "packages/core/src/editor/**",
      "packages/core/src/embed/**",
      "packages/core/src/paperStack/**",
      "packages/core/src/zoneEdit/**",
    ],
  },
  {
    name: "Y.Doc codecs",
    files: "packages/core/src/ydoc/**",
    forbidden: [
      "packages/core/src/editor/**",
      "packages/core/src/embed/**",
      "packages/core/src/paperStack/**",
      "packages/core/src/zoneEdit/**",
    ],
  },
  {
    name: "DOCX import/export",
    files: "packages/core/src/docx/**",
    forbidden: [
      "packages/core/src/editor/**",
      "packages/core/src/embed/**",
      "packages/core/src/paperStack/**",
      "packages/core/src/zoneEdit/**",
    ],
  },
  {
    name: "pure paginator",
    files: "packages/core/src/pagination/**",
    forbidden: [
      "packages/core/src/editor/**",
      "packages/core/src/embed/**",
      "packages/core/src/paperStack/**",
      "packages/core/src/docx/**",
      "packages/core/src/zoneEdit/**",
    ],
  },
] as const;

describe("Sobree architecture fitness", () => {
  describe("@sobree/core boundary", () => {
    for (const pluginFolder of pluginSrcFolders) {
      it(`core does not depend on ${pluginFolder}`, async () => {
        const rule = projectFiles(tsconfig)
          .inFolder(coreSrc)
          .shouldNot()
          .dependOnFiles()
          .inFolder(pluginFolder);

        await expect(rule).toPassAsync(checkOptions);
      });
    }
  });

  describe("plugin package isolation", () => {
    for (const subject of pluginSrcFolders) {
      for (const sibling of pluginSrcFolders) {
        if (subject === sibling) continue;

        it(`${subject} does not depend on ${sibling}`, async () => {
          const rule = projectFiles(tsconfig)
            .inFolder(subject)
            .shouldNot()
            .dependOnFiles()
            .inFolder(sibling);

          await expect(rule).toPassAsync(checkOptions);
        });
      }
    }
  });

  describe("pure core zones stay below orchestration layers", () => {
    for (const zone of pureCoreZones) {
      for (const forbidden of zone.forbidden) {
        it(`${zone.name} does not depend on ${forbidden}`, async () => {
          const rule = projectFiles(tsconfig)
            .inFolder(zone.files)
            .shouldNot()
            .dependOnFiles()
            .inFolder(forbidden);

          await expect(rule).toPassAsync(checkOptions);
        });
      }
    }
  });

  describe("cycle guardrails", () => {
    for (const folder of publicPackages) {
      it(`${folder} is internally cycle-free`, async () => {
        const rule = projectFiles(tsconfig).inFolder(folder).should().haveNoCycles();
        await expect(rule).toPassAsync(checkOptions);
      });
    }
  });

  describe("command bus ownership", () => {
    it("core commands are available without opt-in plugins", async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);

      const sobree = createSobree(host, { fitOnMount: "none" });
      await sobree.ready;

      expect(sobree.commands.has("history.undo")).toBe(true);
      expect(sobree.commands.has("history.redo")).toBe(true);
      expect(sobree.commands.has("mark.toggle.bold")).toBe(true);
      expect(sobree.commands.has("mark.toggle.italic")).toBe(true);
      expect(sobree.commands.has("section.insertBreakAfter")).toBe(true);

      sobree.destroy();
      host.remove();
    });
  });
});
