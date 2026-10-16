import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unstable_readConfig } from "wrangler";

interface CfWorkerBuild {
  name: string;
  compatibilityDate: string;
  env: Record<string, { type: string; worker: string; exportName: string }>;
  exports: Record<string, { type: string; storage: string }>;
}

interface WranglerBuildConfig {
  name: string;
  compatibility_date: string;
  durable_objects: {
    bindings: { name: string; script_name?: string; class_name: string }[];
  };
  migrations: { new_sqlite_classes?: string[] }[];
}

const wrangler: WranglerBuildConfig = unstable_readConfig(
  { config: "wrangler.toml" },
  { hideWarnings: true },
);
const cf = JSON.parse(
  readFileSync(
    ".cloudflare/output/v0/workers/default/worker.config.json",
    "utf8",
  ),
) as CfWorkerBuild;

assert.equal(cf.name, wrangler.name, "Worker identity differs between CLIs");
assert.equal(cf.compatibilityDate, wrangler.compatibility_date);
assert.deepEqual(
  Object.entries(cf.env)
    .map(([name, binding]) => {
      assert.equal(binding.type, "durable-object");
      return `${name}:${binding.worker}:${binding.exportName}`;
    })
    .sort(),
  wrangler.durable_objects.bindings
    .map(
      (binding) =>
        `${binding.name}:${binding.script_name ?? wrangler.name}:${binding.class_name}`,
    )
    .sort(),
  "Durable Object bindings differ between CLIs",
);
assert.deepEqual(
  Object.entries(cf.exports)
    .map(([name, entry]) => {
      assert.equal(entry.type, "durable-object");
      return `${name}:${entry.storage}`;
    })
    .sort(),
  wrangler.migrations
    .flatMap((migration) =>
      (migration.new_sqlite_classes ?? []).map((name) => `${name}:sqlite`),
    )
    .sort(),
  "Durable Object storage differs between CLIs",
);
assert.deepEqual(
  readFileSync(".cloudflare/output/v0/workers/default/bundle/index.js"),
  readFileSync("dist/index.js"),
  "cf and Wrangler must produce the same Worker runtime code",
);
console.log(
  "cf and Wrangler: Worker identity, SQLite bindings, and runtime bundle match.",
);
