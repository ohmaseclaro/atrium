import type { AtriumPolicies } from "./types.js";

export type DemoPoliciesInput = {
  perIp?: { maxConcurrent?: number; maxPerHour?: number; cooldownSeconds?: number };
  fleet?: { maxConcurrent?: number; maxPerHour?: number };
  perSession?: { sessionTtlMs?: number; idleTtlMs?: number; memoryMb?: number };
  urlAllowlist?: string[];
};

const ipBuckets = new Map<string, { hour: number; count: number; lastSessionEnd: number }>();
const fleetConcurrent = { n: 0 };

/**
 * Demo-oriented policy preset: merges URL/session limits with optional in-memory rate hints.
 * Full Redis + Turnstile behaviour from the design doc is partially implemented here; extend for production demos.
 */
export function demoPolicies(input: DemoPoliciesInput): AtriumPolicies {
  const urlAllowlist = input.urlAllowlist?.length ? input.urlAllowlist : ["*"];
  const sessionTtlMs = input.perSession?.sessionTtlMs ?? 3 * 60_000;
  const idleTtlMs = input.perSession?.idleTtlMs ?? 45_000;
  return {
    sessionTtlMs,
    idleTtlMs,
    maxConcurrentSessionsPerTenant: input.perIp?.maxConcurrent ?? 1,
    urlAllowlist,
    defaultViewport: { w: 1280, h: 800 },
  };
}

export function demoRateLimitPreCheck(ip: string, cfg: DemoPoliciesInput): Response | null {
  const perIp = cfg.perIp;
  if (!perIp?.maxPerHour) return null;
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  let b = ipBuckets.get(ip);
  if (!b || b.hour !== hour) {
    b = { hour, count: 0, lastSessionEnd: 0 };
    ipBuckets.set(ip, b);
  }
  if (b.count >= perIp.maxPerHour) {
    return new Response(JSON.stringify({ error: "rate_limited", code: "rate_limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(perIp.cooldownSeconds ?? 90),
      },
    });
  }
  if (perIp.cooldownSeconds && now - b.lastSessionEnd < perIp.cooldownSeconds * 1000) {
    return new Response(JSON.stringify({ error: "rate_limited", code: "cooldown" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }
  const fleet = cfg.fleet?.maxConcurrent;
  if (fleet != null && fleetConcurrent.n >= fleet) {
    return new Response(JSON.stringify({ error: "no_capacity", code: "no_capacity" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

export function demoRateLimitOnSessionCreated(ip: string, cfg: DemoPoliciesInput): void {
  const b = ipBuckets.get(ip);
  if (b) {
    b.count += 1;
  }
  if (cfg.fleet?.maxConcurrent != null) fleetConcurrent.n += 1;
}

export function demoRateLimitOnSessionDestroyed(ip: string, cfg: DemoPoliciesInput): void {
  const b = ipBuckets.get(ip);
  if (b) {
    b.lastSessionEnd = Date.now();
  }
  if (cfg.fleet?.maxConcurrent != null) fleetConcurrent.n = Math.max(0, fleetConcurrent.n - 1);
}
