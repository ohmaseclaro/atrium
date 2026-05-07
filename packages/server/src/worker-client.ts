/**
 * Derive HTTP base from worker WebSocket dial base for internal REST calls.
 */
export function workerHttpBaseFromDial(workerDialBase: string): string {
  return workerDialBase.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
}

export type WorkerInternalFetchOptions = {
  method?: string;
  body?: unknown;
};

export async function workerInternalFetch(
  workerDialBase: string,
  workerSharedSecret: string,
  path: string,
  opts: WorkerInternalFetchOptions = {},
): Promise<Response> {
  const base = workerHttpBaseFromDial(workerDialBase);
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      authorization: `Bearer ${workerSharedSecret}`,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
