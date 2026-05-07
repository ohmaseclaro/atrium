import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ohmaseclaro/atrium-protocol",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
