/**
 * Drive the playground's live paginator headlessly.
 *
 * Boots the playground Vite dev server in-process (its middleware
 * already serves corpus fixtures at `/__corpus/<slug>/…`) and a
 * Playwright Chromium, then runs each fixture through
 * `window.__corpusPages(slug)` (apps/playground/src/corpusHarness.ts).
 *
 * One fresh page per fixture, sequentially — pagination settling is
 * detected by a quiet window on `paginate` events, and rapid loads
 * into a shared editor instance report garbage counts.
 */

import { join } from "node:path";

import { type Browser, chromium } from "playwright";
import { createServer } from "vite";

/** Mirror of `CorpusPagesResult` in apps/playground/src/corpusHarness.ts
 *  (the value crosses the page.evaluate boundary as plain JSON). */
export type FixturePagesResult =
  | {
      pageCount: number;
      pageTexts: string[];
      settled: boolean;
      warnings: string[];
    }
  | { error: string };

export type RunFixture = (slug: string) => Promise<FixturePagesResult>;

export async function withPlaygroundBrowser<T>(
  repoRoot: string,
  fn: (runFixture: RunFixture) => Promise<T>,
): Promise<T> {
  const playgroundRoot = join(repoRoot, "apps", "playground");
  const server = await createServer({
    root: playgroundRoot,
    configFile: join(playgroundRoot, "vite.config.ts"),
    logLevel: "error",
    server: { port: 5199, strictPort: false },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    await server.close();
    throw new Error("playground dev server started but reported no local URL");
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const runFixture: RunFixture = async (slug) => {
      // biome-ignore lint/style/noNonNullAssertion: assigned above
      const page = await browser!.newPage();
      try {
        // `?fresh` skips IndexedDB persistence — each fixture must load
        // into an empty editor, not on top of the previous document.
        await page.goto(`${url}?fresh`, { waitUntil: "load" });
        await page.waitForFunction(
          () => typeof (window as { __corpusPages?: unknown }).__corpusPages === "function",
          undefined,
          { timeout: 30_000 },
        );
        return (await page.evaluate(
          (s) =>
            (
              window as unknown as {
                __corpusPages: (slug: string) => Promise<FixturePagesResult>;
              }
            ).__corpusPages(s),
          slug,
        )) as FixturePagesResult;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      } finally {
        await page.close();
      }
    };
    return await fn(runFixture);
  } finally {
    await browser?.close();
    await server.close();
  }
}
