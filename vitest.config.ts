import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/protocol", "packages/express", "packages/worker", "packages/react"],
  },
});
