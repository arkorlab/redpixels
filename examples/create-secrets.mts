import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const path = ".env.redpixels.json";
writeFileSync(
  path,
  `${JSON.stringify({ API_TOKEN: randomBytes(32).toString("hex") }, null, 2)}\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(`Created ${path}; API_TOKEN generated without printing its value.`);
