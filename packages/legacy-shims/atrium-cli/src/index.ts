const g = globalThis as typeof globalThis & { __atriumLegacyShimWarn?: Set<string> };
if (!g.__atriumLegacyShimWarn) g.__atriumLegacyShimWarn = new Set();
if (!g.__atriumLegacyShimWarn.has("@atriumjs/atrium-cli")) {
  g.__atriumLegacyShimWarn.add("@atriumjs/atrium-cli");
  console.warn("[@atriumjs/atrium-cli] is deprecated; use @atriumjs/cli instead.");
}

export {};
