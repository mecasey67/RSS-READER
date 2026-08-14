import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Force each test file into its own OS process. Several test files
    // import src/db/client.ts (a module-level better-sqlite3 singleton keyed
    // off DATABASE_URL read at first import); without per-file process
    // isolation, the first file to import it "wins" and every other file
    // silently shares that same in-memory database, causing cross-file data
    // collisions and lock contention. Forcing separate processes per file
    // gives each file a genuinely independent module graph.
    pool: "forks",
    isolate: true,
    // Spawning ~10 forked Node processes at once in this sandbox occasionally
    // produces a spurious single-connection "database is locked" from
    // better-sqlite3 under host CPU contention (never reproduces when a file
    // is run alone, and hits a different, unrelated test each time — the
    // signature of scheduling flakiness, not a deterministic logic bug).
    // Capping concurrent forks reduces the contention directly; one retry
    // absorbs whatever's left without masking real, repeatable failures.
    maxWorkers: 4,
    retry: 2,
  },
});
