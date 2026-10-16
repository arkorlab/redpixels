import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/*.spec.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          API_TOKEN: "test-only-token-with-at-least-32-characters",
          WEBHOOK_SECRET: "a-different-webhook-secret-at-least-32-characters",
          SELF_WINDOW_SECONDS: "0",
        },
      },
    }),
  ],
});
