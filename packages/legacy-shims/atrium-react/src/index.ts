const g = globalThis as typeof globalThis & { __atriumLegacyShimWarn?: Set<string> };
if (!g.__atriumLegacyShimWarn) g.__atriumLegacyShimWarn = new Set();
if (!g.__atriumLegacyShimWarn.has("@atriumjs/atrium-react")) {
  g.__atriumLegacyShimWarn.add("@atriumjs/atrium-react");
  console.warn("[@atriumjs/atrium-react] is deprecated; use @atriumjs/react instead.");
}

export * from "@atriumjs/react";
