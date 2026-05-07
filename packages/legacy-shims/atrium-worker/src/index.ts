const g = globalThis as typeof globalThis & { __atriumLegacyShimWarn?: Set<string> };
if (!g.__atriumLegacyShimWarn) g.__atriumLegacyShimWarn = new Set();
if (!g.__atriumLegacyShimWarn.has("@atriumjs/atrium-worker")) {
  g.__atriumLegacyShimWarn.add("@atriumjs/atrium-worker");
  console.warn("[@atriumjs/atrium-worker] is deprecated; use @atriumjs/worker instead.");
}

export * from "@atriumjs/worker";
