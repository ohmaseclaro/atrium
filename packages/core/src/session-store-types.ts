import type { SessionRecord } from "./types.js";

/** Future-facing async session store (design §4.3). The in-process implementation is {@link MemorySessionStore}. */
export interface SessionStore {
  create(s: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  update(id: string, mut: Partial<SessionRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  subscribe(id: string, fn: (e: { type: string }) => void): () => void;
  publish(id: string, e: { type: string }): Promise<void>;
}
