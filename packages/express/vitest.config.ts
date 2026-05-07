import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkgDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Tests should track workspace source; `main` points at `dist/` which is easy to leave stale.
      "@atriumjs/core": path.resolve(pkgDir, "../core/src/index.ts"),
    },
  },
  test: {
    name: "@atriumjs/express",
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
