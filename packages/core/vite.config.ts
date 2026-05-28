import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { libInjectCss } from "vite-plugin-lib-inject-css";

/**
 * @sobree/core build — emits ESM + .d.ts to ./dist.
 *
 * `tokens.css` ships as a sub-export. The Vite build only handles the JS
 * bundle; the CSS file is copied verbatim by the `build` script (see
 * package.json) so `import "@sobree/core/tokens.css"` keeps working at
 * the published path.
 *
 * `libInjectCss` preserves any CSS side-effect imports inside the JS
 * bundle (none today in core, but the plugin is harmless and keeps the
 * three packages' Vite configs symmetric).
 */
export default defineConfig({
  plugins: [
    libInjectCss(),
    dts({
      entryRoot: "src",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      rollupTypes: true,
      tsconfigPath: "./tsconfig.json",
    }),
  ],
  build: {
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["fflate", "yjs"],
    },
  },
});
