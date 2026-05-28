#!/usr/bin/env node
/**
 * Boot a local @sobree/collab-server + the playground vite dev server
 * in one process, so opening two browser tabs to
 * http://localhost:5174?mode=collab demonstrates real collab.
 *
 * Used by the root-level `pnpm dev:collab` script. Ctrl+C cleanly
 * shuts down both.
 *
 * Storage lives under ./.dev-collab-data/<room>.ydoc — gitignored.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import {
  SobreeCollabServer,
  filesystemPersistence,
} from "@sobree/collab-server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

const SERVER_PORT = Number(process.env.SOBREE_COLLAB_PORT ?? 1234);
const PLAYGROUND_PORT = Number(process.env.SOBREE_PLAYGROUND_PORT ?? 5174);
const DATA_DIR = join(repoRoot, ".dev-collab-data");

console.log("");
console.log("🟡 Sobree dev:collab");
console.log("─────────────────────────────────────────────");

// Start the collab server.
const server = new SobreeCollabServer({
  port: SERVER_PORT,
  persistence: filesystemPersistence({ dir: DATA_DIR }),
});
await server.listen();
console.log(`   collab-server   ws://localhost:${SERVER_PORT}`);
console.log(`   persistence     ${DATA_DIR}`);

// Spawn the playground. Vite reads the port from --port; we override
// the default if PLAYGROUND_PORT is set.
const playgroundDir = join(repoRoot, "apps", "playground");
const vite = spawn(
  "pnpm",
  ["exec", "vite", "--port", String(PLAYGROUND_PORT)],
  {
    stdio: "inherit",
    cwd: playgroundDir,
    env: { ...process.env, FORCE_COLOR: "1" },
  },
);

console.log(`   playground      http://localhost:${PLAYGROUND_PORT}`);
console.log("");
console.log("Open in two browser tabs to see live collab:");
console.log(
  `   http://localhost:${PLAYGROUND_PORT}?mode=collab&room=demo&name=Alice&color=%23f59e0b`,
);
console.log(
  `   http://localhost:${PLAYGROUND_PORT}?mode=collab&room=demo&name=Bob&color=%2360a5fa`,
);
console.log("");
console.log("Ctrl+C to stop.");
console.log("─────────────────────────────────────────────");
console.log("");

const shutdown = async (signal) => {
  console.log(`\n${signal} received — shutting down...`);
  try {
    vite.kill();
  } catch {
    /* ignore */
  }
  try {
    await server.close();
  } catch (err) {
    console.error("collab-server close failed:", err);
  }
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

vite.on("exit", (code) => {
  console.log(`\nvite exited (${code}) — shutting collab-server down too`);
  void shutdown("vite-exit");
});
