import { defineConfig } from "vitest/config";

// Unit tests run in plain Node; the app's vite.config.ts loads the Cloudflare
// plugin, which tests do not need. The live evaluation has its own config.
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "eval/**/*.test.ts"] }
});
