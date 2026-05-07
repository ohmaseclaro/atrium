import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = process.env.ATRIUM_WORKER_PORT ?? "7070";
const url = `http-get://127.0.0.1:${port}`;
const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const r = spawnSync("pnpm", ["exec", "wait-on", "-t", "120000", url], {
  cwd: demoRoot,
  stdio: "inherit",
  env: process.env,
});
if (r.error) throw r.error;
process.exit(r.status ?? 1);
