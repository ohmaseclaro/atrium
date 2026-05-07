#!/usr/bin/env node
import process from "node:process";

const [, , cmd] = process.argv;

if (cmd === "doctor") {
  console.log("atrium doctor: Node", process.version);
  console.log("Run the worker with: pnpm --filter @atrium/worker start");
  console.log("Set ATRIUM_WORKER_DRY=1 for smoke tests without Chromium.");
  process.exit(0);
}

console.log(`atrium cli v0.1 — unknown command "${cmd ?? ""}". Try: atrium doctor`);
process.exit(1);
