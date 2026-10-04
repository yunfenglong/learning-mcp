import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [command, ...rest] = process.argv.slice(2);
const commands = {
  build: [
    "deploy",
    "--dry-run",
    ...(rest.includes("--outdir") ? [] : ["--outdir", "dist"]),
  ],
  dev: ["dev"],
  deploy: ["deploy"],
};
if (!commands[command]) throw new Error("Choose build, dev or deploy.");
if (command === "deploy") {
  const guard = spawnSync(
    process.execPath,
    [resolve("scripts/upstreams.mjs"), "check"],
    { stdio: "inherit" },
  );
  if (guard.status !== 0)
    throw new Error(
      "Upstream freshness check failed. Sync and validate before deploying.",
    );
}
const logPath = resolve(".wrangler/logs");
mkdirSync(logPath, { recursive: true });
// Wrangler resolves bundle and README paths against different directories when
// --config is nested. An absolute outdir keeps both artifacts in the same place.
const args = [...commands[command], ...rest];
const outdir = args.indexOf("--outdir");
if (outdir >= 0) args[outdir + 1] = resolve(args[outdir + 1]);
const result = spawnSync(
  process.execPath,
  [resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: logPath,
      WRANGLER_SEND_METRICS: "false",
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
