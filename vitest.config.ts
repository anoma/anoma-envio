import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 120s ceiling for the integration suites (graphql/parity) that hit live RPC;
    // in-memory unit tests finish in milliseconds regardless of this max.
    testTimeout: 120_000,
  },
});
