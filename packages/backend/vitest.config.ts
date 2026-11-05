import dotenv from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Load the isolated test database connection before test files are imported.
dotenv.config({
  path: resolve(process.cwd(), "../../.env.test"),
});

if (!process.env.DATABASE_URL) {
  throw new Error("Test DATABASE_URL is not configured.");
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_SECRET: "decisiontrace-test-secret-only-32-characters-minimum",
    },
    fileParallelism: false,
    testTimeout: 10000,
  },
});