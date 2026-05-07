import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@atrium/protocol",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
