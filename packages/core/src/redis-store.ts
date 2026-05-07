import type { SessionStore } from "./session-store-types.js";

/**
 * Placeholder for horizontal scale-out. Prefer {@link createMemoryStore} today.
 * When wired, this will back {@link CreateAtriumConfig} `store` with Redis persistence + pub/sub.
 */
export function redisStore(_cfg: { url: string }): SessionStore {
  throw new Error(
    "@atriumjs/core redisStore() is not wired in this release. Use createMemoryStore() from @atriumjs/core or open an issue for Redis-backed SessionStore.",
  );
}
