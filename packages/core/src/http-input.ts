/** Normalized HTTP surface for framework adapters (Express, Fetch, Fastify, …). */
export type AtriumHttpInput = {
  method: string;
  /** Pathname only, e.g. `/sessions/abc` (mount prefix already stripped). */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  jsonBody: () => Promise<unknown>;
  /** Populated when the adapter can provide the native framework request (e.g. Express). */
  nativeRequest?: unknown;
};

export async function webRequestToAtriumInput(req: globalThis.Request): Promise<AtriumHttpInput> {
  const u = new URL(req.url);
  return {
    method: req.method,
    path: u.pathname,
    query: u.searchParams,
    headers: new Headers(req.headers),
    jsonBody: async () => {
      const ct = req.headers.get("content-type") ?? "";
      if (req.method === "GET" || req.method === "HEAD") return undefined;
      if (ct.includes("application/json")) {
        try {
          return await req.json();
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
  };
}
