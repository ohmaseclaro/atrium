import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@atriumjs/protocol",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
