import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(__dirname, "..");

/** Pick an ephemeral TCP port on 127.0.0.1 (avoids EADDRINUSE when 7070 is taken). */
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const p = typeof a === "object" && a && typeof a.port === "number" ? a.port : null;
      s.close((err) => (err ? reject(err) : p ? resolve(p) : reject(new Error("no port"))));
    });
  });
}

const portExplicit = Boolean(process.env.ATRIUM_WORKER_PORT);
let port;
if (portExplicit) {
  port = Number(process.env.ATRIUM_WORKER_PORT);
  if (!Number.isFinite(port) || port <= 0) {
    console.error("[atrium-demo] invalid ATRIUM_WORKER_PORT");
    process.exit(1);
  }
} else {
  port = await pickFreePort();
}

/** When the port is auto-picked, dial base must match it (ignore a stale `.env` default). */
const dialBase = portExplicit
  ? (process.env.ATRIUM_WORKER_DIAL_BASE ?? `ws://127.0.0.1:${port}`)
  : `ws://127.0.0.1:${port}`;
const env = {
  ...process.env,
  ATRIUM_WORKER_PORT: String(port),
  ATRIUM_WORKER_DIAL_BASE: dialBase,
};

console.log(`[atrium-demo] worker port ${port}  dial ${dialBase}`);

const child = spawn(
  "pnpm",
  [
    "exec",
    "concurrently",
    "-n",
    "worker,web",
    "-c",
    "blue,magenta",
    "pnpm run dev:worker",
    "pnpm run dev:web",
  ],
  { cwd: demoRoot, env, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
