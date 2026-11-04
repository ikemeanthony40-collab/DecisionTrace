
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      DATABASE_PATH: ":memory:",
      JWT_SECRET: "decisiontrace-test-secret-only-32-characters-minimum",
    },
    fileParallelism: false,
    testTimeout: 10000,
  },
});
