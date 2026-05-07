#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const k = "__atriumWorkerBinShimWarned";
if (!globalThis[k]) {
  globalThis[k] = true;
  console.warn(
    "[@atriumjs/atrium-worker] bin is deprecated; use `pnpm exec atrium-worker` from @atriumjs/worker.",
  );
}

const require = createRequire(import.meta.url);
const runEntry = require.resolve("@atriumjs/worker/dist/run.js");
await import(pathToFileURL(runEntry).href);
