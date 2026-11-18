import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

const testEnv = dotenv.parse(readFileSync(new URL(".env.test", import.meta.url)));

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 30000,
    env: testEnv,
  },
});
