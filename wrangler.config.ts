import { defineWranglerConfig } from "wrangler/experimental-config";

// Build settings used by cf's Wrangler bundler. The Wrangler CLI uses wrangler.toml.
export default defineWranglerConfig({
  types: { generate: false },
});
