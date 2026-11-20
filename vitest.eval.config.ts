import { defineConfig } from "vitest/config";

// `npm run eval`: calls the real model, so it is not part of `npm test`.
export default defineConfig({
  test: { include: ["eval/run.eval.ts"], testTimeout: 30 * 60 * 1000 }
});
