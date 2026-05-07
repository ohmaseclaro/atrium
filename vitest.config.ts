import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/protocol", "packages/server", "packages/worker", "packages/react"],
  },
});
