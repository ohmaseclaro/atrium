import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@atriumjs/atrium-protocol",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
