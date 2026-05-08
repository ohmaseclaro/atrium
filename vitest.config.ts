import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/protocol",
      "packages/core",
      "packages/express",
      "packages/worker",
      "packages/react",
    ],
  },
});
