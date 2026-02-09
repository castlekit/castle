import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/stress/**/*.test.ts"],
    testTimeout: 60000, // 60s per test — stress tests are slow
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
