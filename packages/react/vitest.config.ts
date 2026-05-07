import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "@atriumjs/atrium-react",
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    globals: true,
  },
});
