import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Live LLM chat capability evals.
 * Run: npm run test:chat-capability
 * Requires OPENAI_API_KEY (and optionally OPENAI_MODEL / CHAT_EVAL_MODEL).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["evals/**/*.{test,spec}.ts", "evals/**/*.eval.test.ts"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 240_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".."),
    },
  },
});
