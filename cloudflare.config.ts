import { bindings, defineConfig, exports } from "cf/config";

// Keep the Worker identity, entrypoint, date, and storage in sync with wrangler.toml.
// Personal configuration belongs in Worker secrets, never in source.
export default defineConfig({
  worker: {
    name: "redpixels",
    entrypoint: "src/index.ts",
    compatibilityDate: "2026-10-16",
    env: {
      TRACKER: bindings.durableObject({
        worker: "redpixels",
        exportName: "Tracker",
      }),
    },
    exports: {
      Tracker: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
