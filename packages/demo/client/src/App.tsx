import { useCallback, useEffect, useState } from "react";
import { sessionStatusSchema } from "@atrium/protocol";
import { RemoteBrowser } from "@atrium/react";

type SessionPayload = {
  sessionId: string;
  viewerToken: string;
  wsUrl: string;
  expiresAt: number;
};

type HealthJson = { ok?: boolean };
type ReadyJson = { ok?: boolean; workerDialBase?: string };

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function App(): JSX.Element {
  const [health, setHealth] = useState<HealthJson | null>(null);
  const [ready, setReady] = useState<ReadyJson | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [sessionInfo, setSessionInfo] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [xSnapshot, setXSnapshot] = useState<string | null>(null);
  const [tweetDraft, setTweetDraft] = useState(
    "Hello from Atrium X demo — automated post after login.",
  );

  const log = useCallback((line: string) => {
    setEvents((prev) => [...prev.slice(-40), `${new Date().toISOString().slice(11, 19)} ${line}`]);
  }, []);

  const refreshProbes = useCallback(async () => {
    setError(null);
    try {
      const [h, r] = await Promise.all([fetch("/atrium/healthz"), fetch("/atrium/readyz")]);
      setHealth(await readJson<HealthJson>(h));
      setReady(await readJson<ReadyJson>(r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "probe_failed");
    }
  }, []);

  useEffect(() => {
    void refreshProbes();
  }, [refreshProbes]);

  const createSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/atrium/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const data = (await res.json()) as SessionPayload;
      setSession(data);
      setSessionInfo(null);
      setXSnapshot(null);
      log(`session_created id=${data.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create_failed");
    } finally {
      setBusy(false);
    }
  }, [log]);

  const startXLoginFlow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/atrium/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          initialUrl: "https://x.com/i/flow/login",
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const data = (await res.json()) as SessionPayload;
      setSession(data);
      setSessionInfo(null);
      setXSnapshot(null);
      log(`x_flow_session id=${data.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "x_flow_failed");
    } finally {
      setBusy(false);
    }
  }, [log]);

  const fetchSession = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/atrium/sessions/${session.sessionId}`);
      const data = await readJson<unknown>(res);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      setSessionInfo(data);
      log(`session_get ok`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "get_failed");
    } finally {
      setBusy(false);
    }
  }, [session, log]);

  const destroySession = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/atrium/sessions/${session.sessionId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      log(`session_deleted id=${session.sessionId}`);
      setSession(null);
      setSessionInfo(null);
      setXSnapshot(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setBusy(false);
    }
  }, [session, log]);

  const postControl = useCallback(
    async (action: "grant" | "release", to?: "human") => {
      if (!session) return;
      setBusy(true);
      setError(null);
      try {
        const body =
          action === "grant" ? { action: "grant", to: to ?? "human" } : { action: "release" };
        const res = await fetch(`/atrium/sessions/${session.sessionId}/control`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`HTTP ${res.status}: ${t}`);
        }
        log(`control_${action}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "control_failed");
      } finally {
        setBusy(false);
      }
    },
    [session, log],
  );

  const pullSessionSnapshot = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/atrium/sessions/${session.sessionId}/session-snapshot`);
      const data = await readJson<unknown>(res);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      setXSnapshot(JSON.stringify(data, null, 2));
      log("session_snapshot_ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "snapshot_failed");
    } finally {
      setBusy(false);
    }
  }, [session, log]);

  const postXTweet = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/atrium/sessions/${session.sessionId}/x-demo/compose-tweet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: tweetDraft }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t}`);
      }
      log("x_compose_ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "compose_failed");
    } finally {
      setBusy(false);
    }
  }, [session, tweetDraft, log]);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 960,
        margin: "0 auto",
        padding: 24,
        color: "#111827",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Atrium demo</h1>
        <p style={{ margin: 0, color: "#4b5563", lineHeight: 1.5 }}>
          This app uses <code>@atrium/server</code> (Express + dial relay),{" "}
          <code>@atrium/react</code> (<code>RemoteBrowser</code>), and the same defaults as the root
          README. Run <code>pnpm --filter @atrium/demo dev</code> so the worker starts on port 7070
          before the web server binds.
        </p>
      </header>

      <p style={{ fontSize: 13, color: "#4b5563", marginBottom: 12 }}>
        <strong>@atrium/protocol</strong> in this bundle: session statuses{" "}
        <code>{sessionStatusSchema.options.join(", ")}</code>
      </p>

      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 20,
        }}
      >
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <strong>GET /atrium/healthz</strong>
          <pre style={{ margin: "8px 0 0", fontSize: 12, overflow: "auto" }}>
            {health ? JSON.stringify(health, null, 2) : "…"}
          </pre>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <strong>GET /atrium/readyz</strong>
          <pre style={{ margin: "8px 0 0", fontSize: 12, overflow: "auto" }}>
            {ready ? JSON.stringify(ready, null, 2) : "…"}
          </pre>
        </div>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button type="button" onClick={() => void refreshProbes()} disabled={busy}>
          Refresh probes
        </button>
        <button type="button" onClick={() => void createSession()} disabled={busy}>
          POST /atrium/sessions (example.com)
        </button>
        <button type="button" onClick={() => void fetchSession()} disabled={busy || !session}>
          GET session
        </button>
        <button type="button" onClick={() => void destroySession()} disabled={busy || !session}>
          DELETE session
        </button>
      </div>

      <section
        style={{
          border: "1px solid #fcd34d",
          background: "#fffbeb",
          borderRadius: 10,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>X (Twitter) workflow demo</h2>
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "#92400e", lineHeight: 1.55 }}>
          Opens <code>x.com</code> login in the remote browser. Use <strong>Grant control</strong>,
          click the canvas to focus, then sign in. Pull a <strong>session snapshot</strong> (cookies
          + Playwright <code>storageState</code>), return control to automation, and run{" "}
          <strong>Compose tweet</strong>. This can fail if X changes their UI, blocks automation, or
          shows a challenge. The worker runs <strong>headed</strong> by default; on macOS/Windows
          you get a real window. On Linux without a display, run the worker under{" "}
          <code>xvfb-run</code> (see root README / Docker) or set{" "}
          <code>ATRIUM_WORKER_HEADLESS=1</code> only if you accept headless.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => void startXLoginFlow()} disabled={busy}>
            Start X login flow
          </button>
          <button
            type="button"
            onClick={() => void postControl("grant", "human")}
            disabled={busy || !session}
          >
            Grant control (human)
          </button>
          <button
            type="button"
            onClick={() => void postControl("release")}
            disabled={busy || !session}
          >
            Return control (agent)
          </button>
          <button
            type="button"
            onClick={() => void pullSessionSnapshot()}
            disabled={busy || !session}
          >
            GET session snapshot
          </button>
        </div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
          Tweet text (max 280)
          <textarea
            value={tweetDraft}
            onChange={(e) => setTweetDraft(e.target.value)}
            rows={3}
            style={{
              display: "block",
              width: "100%",
              marginTop: 6,
              fontFamily: "inherit",
              fontSize: 14,
              padding: 8,
              borderRadius: 6,
              border: "1px solid #d1d5db",
            }}
          />
        </label>
        <button type="button" onClick={() => void postXTweet()} disabled={busy || !session}>
          POST x-demo compose tweet
        </button>
        {xSnapshot ? (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>Last snapshot JSON</summary>
            <pre
              style={{
                marginTop: 8,
                maxHeight: 220,
                overflow: "auto",
                fontSize: 11,
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: 8,
              }}
            >
              {xSnapshot}
            </pre>
          </details>
        ) : null}
      </section>

      {error ? (
        <p style={{ color: "#b91c1c", marginBottom: 12 }} role="alert">
          {error}
        </p>
      ) : null}

      {sessionInfo ? (
        <pre
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            marginBottom: 16,
            overflow: "auto",
          }}
        >
          {JSON.stringify(sessionInfo, null, 2)}
        </pre>
      ) : null}

      {session ? (
        <RemoteBrowser
          sessionId={session.sessionId}
          viewerToken={session.viewerToken}
          wsUrl={session.wsUrl}
          chrome="full"
          showSessionStatus
          interactive
          onControlChange={(holder) => log(`control:${holder}`)}
          onTerminated={(reason) => {
            log(`terminated:${reason}`);
            setSession(null);
            setXSnapshot(null);
          }}
          style={{ marginTop: 8 }}
        />
      ) : (
        <p style={{ color: "#6b7280" }}>
          Create a session (generic or X flow) to open the viewer WebSocket and render frames.
        </p>
      )}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16 }}>Event log</h2>
        <ul
          style={{
            fontSize: 12,
            color: "#374151",
            paddingLeft: 18,
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {events.map((e, i) => (
            <li key={`${i}-${e}`}>{e}</li>
          ))}
        </ul>
      </section>

      <footer style={{ marginTop: 32, fontSize: 12, color: "#9ca3af" }}>
        <code>@atrium/protocol</code> types power the wire format; run{" "}
        <code>pnpm --filter @atrium/cli exec atrium doctor</code> from the repo root for the CLI
        placeholder.
      </footer>
    </div>
  );
}
