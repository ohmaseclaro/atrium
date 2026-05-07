import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { RemoteBrowser } from "@atriumjs/atrium-react";

const DEFAULT_TWEET = "Hello from Atrium X demo — automated post after login.";

type SessionPayload = {
  sessionId: string;
  viewerToken: string;
  wsUrl: string;
  expiresAt: number;
};

type FlowPhase = "tweet" | "starting" | "login" | "posting" | "done";

export function App(): JSX.Element {
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<SessionPayload | null>(null);
  const flowActiveRef = useRef(false);

  const [flowOpen, setFlowOpen] = useState(false);
  const [phase, setPhase] = useState<FlowPhase>("tweet");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyStart, setBusyStart] = useState(false);
  const [busyPost, setBusyPost] = useState(false);
  const [tweetDraft, setTweetDraft] = useState(DEFAULT_TWEET);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const destroySession = useCallback(async (s: SessionPayload) => {
    try {
      await fetch(`/atrium/sessions/${s.sessionId}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }, []);

  const leaveFlow = useCallback(async () => {
    flowActiveRef.current = false;
    const s = sessionRef.current;
    sessionRef.current = null;
    if (document.fullscreenElement) {
      await document.exitFullscreen?.().catch(() => undefined);
    }
    if (s) await destroySession(s);
    setSession(null);
    setFlowOpen(false);
    setPhase("tweet");
    setError(null);
  }, [destroySession]);

  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement != null) return;
      if (!flowActiveRef.current) return;
      flowActiveRef.current = false;
      const s = sessionRef.current;
      sessionRef.current = null;
      if (s) void destroySession(s);
      setSession(null);
      setFlowOpen(false);
      setPhase("tweet");
      setError(null);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [destroySession]);

  const grantHuman = useCallback(async (s: SessionPayload) => {
    const res = await fetch(`/atrium/sessions/${s.sessionId}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grant", to: "human" }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Grant control failed: HTTP ${res.status}: ${t}`);
    }
  }, []);

  const releaseAgent = useCallback(async (s: SessionPayload) => {
    const res = await fetch(`/atrium/sessions/${s.sessionId}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "release" }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Return control failed: HTTP ${res.status}: ${t}`);
    }
  }, []);

  const loginAndPost = useCallback(() => {
    setError(null);
    flowActiveRef.current = true;
    flushSync(() => {
      setFlowOpen(true);
      setPhase("starting");
    });
    const el = fullscreenRootRef.current;
    if (el) {
      void el.requestFullscreen?.().catch(() => undefined);
    }

    void (async () => {
      setBusyStart(true);
      try {
        const res = await fetch("/atrium/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initialUrl: "https://x.com/i/flow/login" }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body}`);
        }
        const data = (await res.json()) as SessionPayload;
        setSession(data);
        await grantHuman(data);
        setPhase("login");
      } catch (e) {
        setError(e instanceof Error ? e.message : "start_failed");
        await leaveFlow();
      } finally {
        setBusyStart(false);
      }
    })();
  }, [grantHuman, leaveFlow]);

  const finishLoginAndTweet = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setBusyPost(true);
    setError(null);
    try {
      const snap = await fetch(`/atrium/sessions/${s.sessionId}/session-snapshot`);
      const snapText = await snap.text();
      if (!snap.ok) {
        throw new Error(`Session snapshot failed: HTTP ${snap.status}: ${snapText.slice(0, 800)}`);
      }

      setPhase("posting");
      await releaseAgent(s);

      const compose = await fetch(`/atrium/sessions/${s.sessionId}/x-demo/compose-tweet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: tweetDraft.trim() || DEFAULT_TWEET }),
      });
      if (!compose.ok) {
        const t = await compose.text();
        throw new Error(`Compose tweet failed: HTTP ${compose.status}: ${t}`);
      }
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "post_failed");
    } finally {
      setBusyPost(false);
    }
  }, [releaseAgent, tweetDraft]);

  const floatingHint = (() => {
    if (phase === "starting" || busyStart) {
      return "Starting a secure remote browser on X…";
    }
    if (phase === "login") {
      return "Sign in on the page below. Passkeys are not supported — use password or code.";
    }
    if (phase === "posting") {
      return "Watch the remote browser — your tweet is being sent.";
    }
    if (phase === "done") {
      return "Your tweet was sent from the remote session.";
    }
    return "";
  })();

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: 0,
        fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
        background: "radial-gradient(120% 80% at 50% 0%, #1e293b 0%, #0f172a 45%, #020617 100%)",
        color: "#f8fafc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <article
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 20,
          padding: 28,
          boxSizing: "border-box",
          background:
            "linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        <header style={{ marginBottom: 20 }}>
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#94a3b8",
              fontWeight: 600,
            }}
          >
            Atrium demo
          </p>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Post from a remote browser
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.55, color: "#cbd5e1" }}>
            One flow: we open X for you in fullscreen, you sign in, then we capture the session and
            send this tweet while you watch.
          </p>
        </header>

        <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>
          Tweet
        </label>
        <textarea
          value={tweetDraft}
          onChange={(e) => setTweetDraft(e.target.value)}
          maxLength={280}
          rows={4}
          disabled={flowOpen}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            minHeight: 100,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(2,6,23,0.55)",
            color: "#f1f5f9",
            fontSize: 16,
            lineHeight: 1.45,
            padding: "14px 16px",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b", textAlign: "right" }}>
          {tweetDraft.length}/280
        </p>

        {error ? (
          <p style={{ color: "#fca5a5", fontSize: 14, marginTop: 16 }} role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={loginAndPost}
          disabled={flowOpen || busyStart || !tweetDraft.trim()}
          style={{
            marginTop: 22,
            width: "100%",
            border: "none",
            borderRadius: 999,
            padding: "14px 22px",
            fontSize: 16,
            fontWeight: 600,
            cursor: flowOpen || busyStart || !tweetDraft.trim() ? "not-allowed" : "pointer",
            background:
              flowOpen || busyStart || !tweetDraft.trim()
                ? "rgba(148,163,184,0.35)"
                : "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
            color: "#020617",
            boxShadow:
              flowOpen || busyStart || !tweetDraft.trim()
                ? "none"
                : "0 10px 28px rgba(37,99,235,0.45)",
          }}
        >
          {busyStart ? "Opening…" : "Login and post"}
        </button>
      </article>

      {flowOpen ? (
        <div
          ref={fullscreenRootRef}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            background: "#020617",
          }}
        >
          {session ? (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <RemoteBrowser
                sessionId={session.sessionId}
                viewerToken={session.viewerToken}
                wsUrl={session.wsUrl}
                chrome="full"
                fullScreen
                showSessionStatus={false}
                interactive
                webauthnNotice
                onExitFullScreen={() => void leaveFlow()}
                onTerminated={() => void leaveFlow()}
                style={{ flex: 1, minHeight: 0 }}
              />
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 16,
                color: "#94a3b8",
                fontSize: 15,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "3px solid rgba(148,163,184,0.25)",
                  borderTopColor: "#38bdf8",
                  animation: "atrium-spin 0.9s linear infinite",
                }}
              />
              <p style={{ margin: 0 }}>Preparing your remote browser…</p>
              <style>{`@keyframes atrium-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          <div
            style={{
              position: "fixed",
              left: "50%",
              bottom: 28,
              transform: "translateX(-50%)",
              zIndex: 1100,
              width: "min(420px, calc(100vw - 32px))",
              borderRadius: 16,
              padding: "16px 18px",
              boxSizing: "border-box",
              background: "rgba(15,23,42,0.92)",
              border: "1px solid rgba(148,163,184,0.25)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
              backdropFilter: "blur(10px)",
            }}
          >
            <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.5, color: "#e2e8f0" }}>
              {floatingHint}
            </p>
            {phase === "login" ? (
              <button
                type="button"
                onClick={() => void finishLoginAndTweet()}
                disabled={busyPost || !session}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: busyPost || !session ? "not-allowed" : "pointer",
                  background: busyPost || !session ? "rgba(71,85,105,0.6)" : "#f8fafc",
                  color: "#0f172a",
                }}
              >
                {busyPost ? "Working…" : "I’m logged in — post my tweet"}
              </button>
            ) : null}
            {phase === "done" ? (
              <button
                type="button"
                onClick={() => void leaveFlow()}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: "#38bdf8",
                  color: "#020617",
                }}
              >
                Close
              </button>
            ) : null}
            {phase === "posting" ? (
              <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                Capturing session and handing off to automation…
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
