import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      entryRoot: "src",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      rollupTypes: true,
      tsconfigPath: "./tsconfig.json",
    }),
  ],
  build: {
    target: "node20",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "yjs",
        "y-protocols",
        "y-protocols/sync",
        "y-protocols/awareness",
        "ws",
        "lib0",
        "lib0/decoding",
        "lib0/encoding",
        "node:fs",
        "node:fs/promises",
        "node:path",
        "node:crypto",
        "node:url",
      ],
    },
  },
});
