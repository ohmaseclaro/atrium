#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createConnection } from "node:net";
import process from "node:process";

const [, , cmd] = process.argv;

function checkWorkerReachable(dialBase: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(dialBase);
    } catch {
      resolve(false);
      return;
    }
    const port = Number(u.port || (u.protocol === "wss:" ? 443 : 80));
    const host = u.hostname;
    const socket = createConnection({ port, host, timeout: timeoutMs }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

if (cmd === "doctor") {
  const node = process.version;
  const dial = process.env.ATRIUM_WORKER_DIAL_BASE ?? "ws://127.0.0.1:7070";
  const secret = process.env.ATRIUM_WORKER_SECRET ? "set" : "missing";
  const dry = process.env.ATRIUM_WORKER_DRY === "1";

  console.log(`atrium doctor — Node ${node}`);
  console.log(`  ATRIUM_WORKER_DIAL_BASE: ${dial}`);
  console.log(`  ATRIUM_WORKER_SECRET: ${secret}`);
  console.log(`  ATRIUM_WORKER_DRY: ${dry ? "1 (no Chromium)" : "unset"}`);

  const ok = await checkWorkerReachable(dial, 1500);
  console.log(
    `  Worker TCP reachability (${dial}): ${ok ? "reachable" : "unreachable or timed out"}`,
  );

  try {
    execSync("node -e \"require.resolve('playwright')\"", { stdio: "ignore" });
    console.log("  playwright: resolvable from cwd (npm/pnpm install)");
  } catch {
    console.log("  playwright: not resolvable from cwd (add playwright for workers)");
  }

  console.log("  Full UI demo: pnpm demo (repo root) — packages/demo/README.md");
  process.exit(0);
}

console.log(`atrium cli v0.2 — unknown command "${cmd ?? ""}". Try: atrium doctor`);
process.exit(1);
