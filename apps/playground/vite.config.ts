import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";

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
 * Expose `tests/corpus/<origin>/<category>/<slug>/libreoffice/*`
 * via `/__corpus/<slug>/libreoffice/*` so the convergence-report
 * tooling (see apps/playground/src/main.ts `convergenceReport`) can
 * fetch the LO reference data without bundling it into the build.
 * Read-only, dev-server only.
 *
 * Scans whatever `<origin>/<category>` dirs exist under the corpus
 * root rather than naming any — the real-world corpus is gitignored
 * and local-only, so no committed code references it.
 */
function serveCorpusMetrics(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const corpusRoot = resolve(here, "../../tests/corpus");
  return {
    name: "sobree-serve-corpus",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__corpus/")) return next();
        const rel = req.url.replace(/^\/__corpus\//, "").replace(/\?.*$/, "");
        try {
          let body: Buffer | null = null;
          // The corpus is <root>/<origin>/<category>/<slug>/…; requests
          // are slug-rooted, so try every origin/category pair present.
          outer: for (const origin of await safeReaddir(corpusRoot)) {
            for (const cat of await safeReaddir(resolve(corpusRoot, origin))) {
              const path = resolve(corpusRoot, origin, cat, rel);
              if (!path.startsWith(corpusRoot)) {
                res.statusCode = 403;
                return res.end("forbidden");
              }
              try {
                body = await readFile(path);
                break outer;
              } catch {
                // try next origin/category
              }
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

/** `readdir` that yields `[]` for a missing/non-dir path instead of throwing. */
async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
