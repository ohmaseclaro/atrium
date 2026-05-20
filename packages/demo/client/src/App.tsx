import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { RemoteBrowser } from "@atriumjs/react";

const DEFAULT_TWEET = "Hello from Atrium X demo - automated post after login.";

type SessionPayload = {
  sessionId: string;
  viewerToken: string;
  wsUrl: string;
  expiresAt: number;
};

type FlowPhase = "tweet" | "starting" | "login" | "posting" | "done";

/** Typed error codes the server can return for compose failures. */
type XErrorCode =
  | "x_session_expired"
  | "x_challenge_required"
  | "x_rate_limited"
  | "x_post_failed"
  | "x_timeout"
  | "x_compose_failed"
  | "worker_x_compose_failed";

const X_ERROR_COPY: Record<XErrorCode, string> = {
  x_session_expired:
    "Your X session expired before the tweet could be sent. Please try the flow again.",
  x_challenge_required:
    'X asked for extra verification mid-flow. Refresh and try again - complete any challenge before clicking "I’m logged in".',
  x_rate_limited: "X rate-limited this post. Wait a minute, then try again.",
  x_post_failed: "X rejected the post. The tweet may be a duplicate or contain blocked content.",
  x_timeout:
    "The tweet timed out waiting for confirmation from X. It may or may not have been sent - check your profile.",
  x_compose_failed: "The automation could not complete the tweet. Please try again.",
  worker_x_compose_failed: "The automation could not complete the tweet. Please try again.",
};

function friendlyError(raw: unknown): string {
  if (!(raw instanceof Error)) return "Unknown error";
  for (const [code, copy] of Object.entries(X_ERROR_COPY) as [XErrorCode, string][]) {
    if (raw.message.includes(code)) return copy;
  }
  return raw.message;
}

/** Wraps a fetch with an AbortController timeout. */
function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

export function App(): JSX.Element {
  const sessionRef = useRef<SessionPayload | null>(null);
  const flowActiveRef = useRef(false);
  const startGuardRef = useRef(false); // prevents double-click race on the start button
  /**
   * Mirror of `phase` state kept in a ref so event callbacks (onTerminated) can
   * read the current phase without capturing a stale closure value.
   */
  const phaseRef = useRef<FlowPhase>("tweet");

  const [flowOpen, setFlowOpen] = useState(false);
  const [phase, setPhase] = useState<FlowPhase>("tweet");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyStart, setBusyStart] = useState(false);
  const [busyPost, setBusyPost] = useState(false);
  const [tweetDraft, setTweetDraft] = useState(DEFAULT_TWEET);
  /** Shadow of RemoteBrowser's internal status - used for stage-aware copy. */
  const [browserStatus, setBrowserStatus] = useState<
    "idle" | "connecting" | "live" | "reconnecting" | "ended"
  >("idle");

  /** Keep phaseRef in sync so callbacks always see the current phase. */
  const setPhaseTracked = useCallback((p: FlowPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

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

  /** Clean up the flow. Pass `preserveError: true` to keep the current error visible. */
  const leaveFlow = useCallback(
    async (opts?: { preserveError?: boolean }) => {
      flowActiveRef.current = false;
      startGuardRef.current = false;
      const s = sessionRef.current;
      sessionRef.current = null;
      if (s) await destroySession(s);
      setSession(null);
      setFlowOpen(false);
      setPhaseTracked("tweet");
      setBrowserStatus("idle");
      if (!opts?.preserveError) setError(null);
    },
    [destroySession, setPhaseTracked],
  );

  // Best-effort session cleanup on page unload
  useEffect(() => {
    const onPageHide = () => {
      const s = sessionRef.current;
      if (!s) return;
      fetch(`/atrium/sessions/${s.sessionId}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const grantHuman = useCallback(async (s: SessionPayload) => {
    const res = await fetchWithTimeout(
      `/atrium/sessions/${s.sessionId}/control`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "grant", to: "human" }),
      },
      10_000,
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Grant control failed: HTTP ${res.status}: ${t}`);
    }
  }, []);

  const releaseAgent = useCallback(async (s: SessionPayload) => {
    const res = await fetchWithTimeout(
      `/atrium/sessions/${s.sessionId}/control`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      },
      10_000,
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Return control failed: HTTP ${res.status}: ${t}`);
    }
  }, []);

  const loginAndPost = useCallback(() => {
    // Guard against double-click or rapid re-entry
    if (startGuardRef.current || flowActiveRef.current) return;
    startGuardRef.current = true;

    setError(null);
    flowActiveRef.current = true;
    flushSync(() => {
      setFlowOpen(true);
      setPhaseTracked("starting");
    });

    void (async () => {
      setBusyStart(true);
      try {
        const res = await fetchWithTimeout(
          "/atrium/sessions",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ initialUrl: "https://x.com/i/flow/login" }),
          },
          15_000,
        );
        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429)
            throw new Error(
              "All demo browser slots are in use right now — please wait a moment and try again.",
            );
          throw new Error(`HTTP ${res.status}: ${body}`);
        }
        const data = (await res.json()) as SessionPayload;
        setSession(data);
        await grantHuman(data);
        setPhaseTracked("login");
      } catch (e) {
        const msg =
          e instanceof Error && e.name === "AbortError"
            ? "Timed out while starting the remote browser - please try again."
            : friendlyError(e);
        setError(msg);
        await leaveFlow({ preserveError: true });
      } finally {
        setBusyStart(false);
        startGuardRef.current = false;
      }
    })();
  }, [grantHuman, leaveFlow, setPhaseTracked]);

  const finishLoginAndTweet = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setBusyPost(true);
    setError(null);
    try {
      const snap = await fetchWithTimeout(
        `/atrium/sessions/${s.sessionId}/session-snapshot`,
        {},
        15_000,
      );
      const snapText = await snap.text();
      if (!snap.ok) {
        throw new Error(`Session snapshot failed: HTTP ${snap.status}: ${snapText.slice(0, 800)}`);
      }

      setPhaseTracked("posting");
      await releaseAgent(s);

      const compose = await fetchWithTimeout(
        `/atrium/sessions/${s.sessionId}/x-demo/compose-tweet`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: tweetDraft.trim() || DEFAULT_TWEET }),
        },
        75_000, // generous: worker has a 30s post-confirmation timeout internally
      );
      if (!compose.ok) {
        let errorCode: string | undefined;
        let errorMessage: string | undefined;
        try {
          const body = (await compose.json()) as { error?: string; message?: string };
          errorCode = body.error;
          errorMessage = body.message;
        } catch {
          /* non-JSON body - fall through */
        }
        const syntheticErr = new Error(errorCode ?? "compose_failed");
        if (errorMessage)
          syntheticErr.message = `${errorCode ?? "compose_failed"}: ${errorMessage}`;
        throw syntheticErr;
      }

      // ── Success: tweet sent ───────────────────────────────────────────────────
      // Immediately free the server-side session so the browser slot is returned
      // to the pool without waiting for the user to click "Close".  We null-out
      // sessionRef first so leaveFlow / onTerminated don't double-delete.
      // The RemoteBrowser will receive a WS "bye" and show "ended", but the
      // "done" overlay (guarded by phaseRef) keeps the UX intact.
      const doneSession = sessionRef.current;
      sessionRef.current = null;
      setPhaseTracked("done");
      if (doneSession) void destroySession(doneSession);
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? "Timed out waiting for the tweet to be sent - check your X profile to see if it went through."
          : friendlyError(e);
      setError(msg);
      // Keep the modal open so the user can retry or close manually
      setPhaseTracked("login");
    } finally {
      setBusyPost(false);
    }
  }, [destroySession, releaseAgent, setPhaseTracked, tweetDraft]);

  // ── floating hint copy ──────────────────────────────────────────────────────
  const floatingHint = (() => {
    if (phase === "starting" || busyStart) {
      if (browserStatus === "live") return "Loading X - almost there…";
      if (browserStatus === "connecting") return "Connecting to your remote browser…";
      return "Allocating a remote browser…";
    }
    if (phase === "login") {
      return (
        "Sign in on the page below - use password or a one-time code." +
        " X may ask for extra verification (email/SMS code, captcha): that's normal, just complete it."
      );
    }
    if (phase === "posting") {
      return "Watch the remote browser - your tweet is being sent…";
    }
    if (phase === "done") {
      return "Your tweet was sent from the remote session. 🎉";
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
            One flow: we open X for you in a full-viewport overlay, you sign in, then we capture the
            session and send this tweet while you watch.
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
                connectingOverlay="none" // demo owns the loading state via onStatusChange
                onStatusChange={setBrowserStatus}
                onExitFullScreen={() => void leaveFlow()}
                onTerminated={() => {
                  // In "done" phase we already freed the session; the "bye" WS
                  // message is expected — don't tear down the confirmation screen.
                  if (phaseRef.current !== "done") void leaveFlow();
                }}
                style={{ flex: 1, minHeight: 0 }}
              />
            </div>
          ) : (
            // Session not yet allocated - show a spinner while POST /atrium/sessions is in-flight
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

          {/* Phase-aware overlay when session is allocated but browser is still warming up */}
          {session &&
          (browserStatus === "connecting" ||
            browserStatus === "idle" ||
            (browserStatus === "live" && phase === "starting")) ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1050,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                background: "#020617",
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
              <p style={{ margin: 0 }}>
                {browserStatus === "live" ? "Loading X…" : "Connecting to remote browser…"}
              </p>
            </div>
          ) : null}

          {/* Floating control strip at the bottom */}
          <div
            style={{
              position: "fixed",
              left: "50%",
              bottom: 28,
              transform: "translateX(-50%)",
              zIndex: 1100,
              width: "min(480px, calc(100vw - 32px))",
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

            {error && (phase === "login" || phase === "posting") ? (
              <p
                role="alert"
                style={{
                  margin: "0 0 12px",
                  fontSize: 13,
                  color: "#fca5a5",
                  lineHeight: 1.45,
                }}
              >
                {error}
              </p>
            ) : null}

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
                {busyPost
                  ? "Working…"
                  : error
                    ? "Retry - post my tweet"
                    : "I'm logged in - post my tweet"}
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

            {phase === "posting" && !busyPost ? null : phase === "posting" ? (
              <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                Capturing session and handing off to automation…
              </p>
            ) : null}

            {/* Always-visible exit link so the user is never stuck */}
            {phase !== "done" ? (
              <button
                type="button"
                onClick={() => void leaveFlow()}
                style={{
                  marginTop: 10,
                  width: "100%",
                  border: "none",
                  background: "none",
                  color: "#64748b",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: "4px 0",
                  textDecoration: "underline",
                }}
              >
                Cancel and close
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
