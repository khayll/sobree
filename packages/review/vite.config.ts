import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { libInjectCss } from "vite-plugin-lib-inject-css";

/**
 * @sobree/review build — emits ESM + .d.ts to ./dist.
 *
 * `libInjectCss` keeps `import "./review.css"` as a side-effect import
 * in the published JS, so consumers get the post-it / mark styling
 * automatically once `@sobree/core/tokens.css` is loaded.
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
      external: ["@sobree/core"],
    },
  },
});
