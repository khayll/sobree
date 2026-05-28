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
      entry: {
        index: "src/index.ts",
        "bin/sobree-mcp": "src/bin/sobree-mcp.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "@modelcontextprotocol/sdk",
        /^@modelcontextprotocol\/sdk\//,
        "@sobree/core",
        "yjs",
        "y-websocket",
        /^node:/,
      ],
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
