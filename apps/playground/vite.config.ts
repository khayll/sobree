import { defineConfig, type Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dev playground for Sobree contributors.
 *
 * Workspace symlinks resolve every `@sobree/*` package straight to its
 * `src/*.ts` via the `development` export condition we set on each
 * package — so HMR works end-to-end: edit anything in
 * `packages/<pkg>/src/`, the playground hot-reloads.
 */
export default defineConfig({
  // The playground is a contributor-only dev tool (not published) that
  // runs in a current browser. Its entry (`src/main.ts`) uses top-level
  // `await` to hydrate the Y.Doc provider before mounting — an ES2022
  // feature. Vite's default `build.target` ("modules": chrome87 / es2020
  // / safari14) predates TLA and rejects it, so we declare the target
  // the app actually runs on. ES2022 is exactly the level that
  // introduced top-level await.
  build: {
    target: "es2022",
  },
  server: {
    port: 5174,
    strictPort: false,
  },
  plugins: [serveCorpusMetrics()],
});

/**
 * Expose `tests/corpus/real-world/<category>/<slug>/libreoffice/*`
 * via `/__corpus/<slug>/libreoffice/*` so the convergence-report
 * tooling (see apps/playground/src/main.ts `convergenceReport`) can
 * fetch the LO reference data without bundling it into the build.
 * Read-only, dev-server only.
 */
function serveCorpusMetrics(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const corpusRoot = resolve(here, "../../tests/corpus/real-world");
  const categories = ["cv", "form", "contract"];
  return {
    name: "sobree-serve-corpus",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__corpus/")) return next();
        const rel = req.url.replace(/^\/__corpus\//, "").replace(/\?.*$/, "");
        try {
          let body: Buffer | null = null;
          // Search the known category subdirs for slug-rooted paths.
          for (const cat of categories) {
            const path = resolve(corpusRoot, cat, rel);
            if (!path.startsWith(corpusRoot)) {
              res.statusCode = 403;
              return res.end("forbidden");
            }
            try {
              body = await readFile(path);
              break;
            } catch {
              // try next category
            }
          }
          if (!body) {
            res.statusCode = 404;
            return res.end("not found");
          }
          if (rel.endsWith(".json")) res.setHeader("content-type", "application/json");
          else if (rel.endsWith(".png")) res.setHeader("content-type", "image/png");
          res.statusCode = 200;
          return res.end(body);
        } catch (err) {
          res.statusCode = 500;
          return res.end(String(err));
        }
      });
    },
  };
}
