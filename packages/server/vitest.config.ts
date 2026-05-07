import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@atriumjs/atrium-server",
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
