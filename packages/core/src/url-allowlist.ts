/**
 * Minimal URL allowlist matching for server-driven navigation.
 * Patterns: "*" (allow all), "https://example.com/*" (prefix), exact URL.
 */
export function urlAllowed(url: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  if (patterns.includes("*")) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p || p === "*") return true;
    if (p.endsWith("*")) {
      const prefix = p.slice(0, -1);
      if (normalized.startsWith(prefix) || url.startsWith(prefix)) return true;
    }
    if (normalized === p || url === p) return true;
  }
  return false;
}
