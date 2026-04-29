import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Run test files sequentially to avoid DB contention between suites
    fileParallelism: false,
    // Suppress better-auth "base URL not set" warning in tests
    env: {
      BETTER_AUTH_URL: "http://localhost:3001",
    },
  },
});
