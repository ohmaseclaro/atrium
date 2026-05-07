#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const k = "__atriumCliBinShimWarned";
if (!globalThis[k]) {
  globalThis[k] = true;
  console.warn(
    "[@atriumjs/atrium-cli] bin is deprecated; use `pnpm exec atrium` from @atriumjs/cli.",
  );
}

const require = createRequire(import.meta.url);
const entry = require.resolve("@atriumjs/cli/dist/index.js");
await import(pathToFileURL(entry).href);
