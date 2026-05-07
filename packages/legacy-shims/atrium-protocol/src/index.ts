const g = globalThis as typeof globalThis & { __atriumLegacyShimWarn?: Set<string> };
if (!g.__atriumLegacyShimWarn) g.__atriumLegacyShimWarn = new Set();
if (!g.__atriumLegacyShimWarn.has("@atriumjs/atrium-protocol")) {
  g.__atriumLegacyShimWarn.add("@atriumjs/atrium-protocol");
  console.warn("[@atriumjs/atrium-protocol] is deprecated; use @atriumjs/protocol instead.");
}

export * from "@atriumjs/protocol";
