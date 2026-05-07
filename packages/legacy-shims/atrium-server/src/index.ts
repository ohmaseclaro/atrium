const g = globalThis as typeof globalThis & { __atriumLegacyShimWarn?: Set<string> };
if (!g.__atriumLegacyShimWarn) g.__atriumLegacyShimWarn = new Set();
if (!g.__atriumLegacyShimWarn.has("@atriumjs/atrium-server")) {
  g.__atriumLegacyShimWarn.add("@atriumjs/atrium-server");
  console.warn("[@atriumjs/atrium-server] is deprecated; use @atriumjs/express instead.");
}

export * from "@atriumjs/express";
