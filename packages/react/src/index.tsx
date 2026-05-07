import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ControlHolder } from "@atrium/protocol";
import { parseServerMessage } from "@atrium/protocol";

export type RemoteBrowserChromeOptions =
  | "none"
  /** Omnibox-style URL bar + back / forward / reload; no tab strip (single-window look). */
  | "minimal"
  /** Tab strip + toolbar + URL bar (embedded-Chrome look). */
  | "full"
  | {
      showTabStrip?: boolean;
      showToolbar?: boolean;
      showUrlBar?: boolean;
    };

export type ResolvedRemoteBrowserChrome = {
  showTabStrip: boolean;
  showToolbar: boolean;
  showUrlBar: boolean;
};

export function resolveRemoteBrowserChrome(
  chrome: RemoteBrowserChromeOptions | undefined,
): ResolvedRemoteBrowserChrome {
  if (chrome == null || chrome === "none") {
    return { showTabStrip: false, showToolbar: false, showUrlBar: false };
  }
  if (chrome === "minimal") {
    return { showTabStrip: false, showToolbar: true, showUrlBar: true };
  }
  if (chrome === "full") {
    return { showTabStrip: true, showToolbar: true, showUrlBar: true };
  }
  return {
    showTabStrip: chrome.showTabStrip ?? false,
    showToolbar: chrome.showToolbar ?? false,
    showUrlBar: chrome.showUrlBar ?? false,
  };
}

export type RemoteBrowserTab = {
  id: string;
  url: string;
  title: string;
  active: boolean;
};

export type WebAuthnRequest = {
  id: string;
  ceremony: "get" | "create";
  rpId?: string;
  origin?: string;
};

export type RemoteBrowserProps = {
  sessionId: string;
  viewerToken: string;
  wsUrl: string;
  /** When true and control is `human`, pointer and keyboard events on the canvas are sent to the worker. */
  interactive?: boolean;
  /**
   * Optional browser chrome around the stream. Presets: `none` (default), `minimal`, `full`.
   * You can also pass an object to turn individual regions on or off (e.g. tabs only, URL bar only).
   */
  chrome?: RemoteBrowserChromeOptions;
  /**
   * Session / control status line above the canvas.
   * Default: shown when chrome is `none`/unset; hidden when any chrome region is enabled (override with `true`).
   */
  showSessionStatus?: boolean;
  /**
   * Passkeys / WebAuthn are **not supported** in remote browsers — the worker pre-empts
   * sites by reporting "no platform authenticator" and any direct call to
   * `navigator.credentials.{get,create}` with a `publicKey` is auto-rejected with
   * `NotAllowedError` so the site falls back to password / OTP.
   *
   * - `true` (default) — show a brief, non-blocking **toast** when a site still tries.
   * - `false` — fully silent (no toast). Pair with `onWebAuthnRequest` for custom UX.
   */
  webauthnNotice?: boolean;
  /** Notified whenever a site attempts a passkey ceremony (for telemetry / custom UX). */
  onWebAuthnRequest?: (req: WebAuthnRequest) => void;
  onControlChange?: (holder: ControlHolder) => void;
  onTerminated?: (reason: string) => void;
  style?: CSSProperties;
  /**
   * When true, stretches to fill the parent (use a parent with `height: 100%` inside a fullscreen element).
   * Renders a top bar with **Exit full screen** that calls `document.exitFullscreen()` when active, then `onExitFullScreen`.
   * For reliable fullscreen, call `element.requestFullscreen()` from the same user gesture that shows this tree (before awaiting network).
   */
  fullScreen?: boolean;
  onExitFullScreen?: () => void;
};

function sendWs(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/**
 * Remote browser viewer: WebSocket relay, JPEG frames on canvas, optional embedded-Chrome-style UI.
 */
export function RemoteBrowser(props: RemoteBrowserProps): JSX.Element {
  const interactive = props.interactive ?? false;
  const webauthnNotice = props.webauthnNotice ?? true;
  const fullScreen = props.fullScreen ?? false;
  const resolvedChrome = useMemo(() => resolveRemoteBrowserChrome(props.chrome), [props.chrome]);
  const showSessionStatus =
    props.showSessionStatus ??
    !(resolvedChrome.showTabStrip || resolvedChrome.showToolbar || resolvedChrome.showUrlBar);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onControlChangeRef = useRef(props.onControlChange);
  const onTerminatedRef = useRef(props.onTerminated);
  const onWebAuthnRequestRef = useRef(props.onWebAuthnRequest);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "ended">("idle");
  const [holder, setHolder] = useState<ControlHolder>("agent");
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const [tabs, setTabs] = useState<RemoteBrowserTab[]>([]);
  const [activeUrl, setActiveUrl] = useState("");
  const [activeTitle, setActiveTitle] = useState("");
  const [webauthnToast, setWebauthnToast] = useState<WebAuthnRequest | null>(null);
  const webauthnToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onControlChangeRef.current = props.onControlChange;
    onTerminatedRef.current = props.onTerminated;
    onWebAuthnRequestRef.current = props.onWebAuthnRequest;
  }, [props.onControlChange, props.onTerminated, props.onWebAuthnRequest]);

  const exitFullScreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
    props.onExitFullScreen?.();
  }, [props.onExitFullScreen]);

  const connect = useCallback(() => {
    const url = new URL(props.wsUrl);
    url.searchParams.set("token", props.viewerToken);
    setStatus("connecting");
    /** Reset stream state so the canvas / chrome / aspect-ratio stage don't display stale
     *  frames or tabs from a previous session while the new one is bootstrapping. */
    setHolder("agent");
    setViewport({ w: 1280, h: 800 });
    setTabs([]);
    setActiveUrl("");
    setActiveTitle("");
    setWebauthnToast(null);
    if (webauthnToastTimerRef.current) {
      clearTimeout(webauthnToastTimerRef.current);
      webauthnToastTimerRef.current = null;
    }
    /** Reassigning `width` clears the canvas per HTML spec, without needing a 2D context
     *  (which jsdom doesn't implement, keeping unit tests quiet). */
    const canvas = canvasRef.current;
    if (canvas) {
      // eslint-disable-next-line no-self-assign
      canvas.width = canvas.width;
    }
    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = parseServerMessage(JSON.parse(ev.data));
          if (msg.t === "hello") {
            setStatus("live");
            setViewport({ w: msg.viewport.w, h: msg.viewport.h });
            setHolder(msg.control.holder);
            onControlChangeRef.current?.(msg.control.holder);
          }
          if (msg.t === "control") {
            setHolder(msg.holder);
            onControlChangeRef.current?.(msg.holder);
          }
          if (msg.t === "viewport") {
            setViewport({ w: msg.w, h: msg.h });
          }
          if (msg.t === "tabs") {
            setTabs(msg.tabs);
          }
          if (msg.t === "webauthn_required") {
            const req: WebAuthnRequest = {
              id: msg.id,
              ceremony: msg.ceremony,
              rpId: msg.rpId,
              origin: msg.origin,
            };
            onWebAuthnRequestRef.current?.(req);
            /** The page-side init script throws `NotAllowedError` immediately, so this
             *  is purely informational. We show a non-blocking toast and auto-clear. */
            if (webauthnNotice) {
              setWebauthnToast(req);
              if (webauthnToastTimerRef.current) {
                clearTimeout(webauthnToastTimerRef.current);
              }
              webauthnToastTimerRef.current = setTimeout(() => {
                setWebauthnToast(null);
                webauthnToastTimerRef.current = null;
              }, 6000);
            }
          }
          if (msg.t === "navigate") {
            setActiveUrl(msg.url);
          }
          if (msg.t === "title") {
            setActiveTitle(msg.title);
          }
          if (msg.t === "bye") {
            setStatus("ended");
            onTerminatedRef.current?.(msg.reason);
          }
        } catch {
          /* ignore */
        }
      } else if (ev.data instanceof ArrayBuffer) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const blob = new Blob([ev.data], { type: "image/jpeg" });
        const img = new Image();
        img.onload = () => {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(blob);
      }
    });

    ws.addEventListener("open", () => {
      setStatus("live");
    });
    ws.addEventListener("close", () => {
      setStatus((s) => (s === "ended" ? s : "ended"));
    });
  }, [props.viewerToken, props.wsUrl, webauthnNotice]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    if (!interactive || holder !== "human" || status !== "live") return;
    const canvas = canvasRef.current;
    const ws = wsRef.current;
    if (!canvas || !ws) return;

    /**
     * Map screen coordinates to Playwright viewport pixels. Accounts for
     * `object-fit: contain` letterboxing and for JPEG dimensions that may differ
     * from `hello.viewport` while sharing the same aspect ratio.
     */
    const clientToViewport = (
      clientX: number,
      clientY: number,
    ): { x: number; y: number } | null => {
      const iw = canvas.width;
      const ih = canvas.height;
      if (iw <= 1 || ih <= 1) return null;

      const rect = canvas.getBoundingClientRect();
      const cw = Math.max(rect.width, 1);
      const ch = Math.max(rect.height, 1);
      const scale = Math.min(cw / iw, ch / ih);
      const dispW = iw * scale;
      const dispH = ih * scale;
      const offX = rect.left + (cw - dispW) / 2;
      const offY = rect.top + (ch - dispH) / 2;
      const lx = clientX - offX;
      const ly = clientY - offY;
      const nx = Math.min(1, Math.max(0, lx / dispW));
      const ny = Math.min(1, Math.max(0, ly / dispH));
      return { x: nx * viewport.w, y: ny * viewport.h };
    };

    const sendMouse = (type: string, ev: PointerEvent): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const mapped = clientToViewport(ev.clientX, ev.clientY);
      if (!mapped) return;
      sendWs(ws, {
        t: "input",
        kind: "mouse",
        payload: { type, x: mapped.x, y: mapped.y, button: ev.button },
      });
    };

    const onPointerDown = (ev: PointerEvent): void => {
      canvas.setPointerCapture(ev.pointerId);
      sendMouse("down", ev);
    };
    const onPointerUp = (ev: PointerEvent): void => {
      sendMouse("up", ev);
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onPointerMove = (ev: PointerEvent): void => {
      sendMouse("move", ev);
    };
    const onWheel = (ev: WheelEvent): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ev.preventDefault();
      sendWs(ws, {
        t: "input",
        kind: "wheel",
        payload: { deltaX: ev.deltaX, deltaY: ev.deltaY },
      });
    };

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ev.target !== canvas) return;
      ev.preventDefault();
      sendWs(ws, {
        t: "input",
        kind: "key",
        payload: { type: "down", key: ev.key, code: ev.code },
      });
    };
    const onKeyUp = (ev: KeyboardEvent): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ev.target !== canvas) return;
      ev.preventDefault();
      sendWs(ws, {
        t: "input",
        kind: "key",
        payload: { type: "up", key: ev.key, code: ev.code },
      });
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
    };
  }, [interactive, holder, status, viewport.w, viewport.h]);

  const anyChrome =
    resolvedChrome.showTabStrip || resolvedChrome.showToolbar || resolvedChrome.showUrlBar;

  const omniboxDisplay = (() => {
    if (activeUrl) return activeUrl;
    const active = tabs.find((t) => t.active);
    return active?.url ?? "";
  })();

  const tabLabel = (t: RemoteBrowserTab): string => {
    const trimmed = t.title?.trim();
    if (trimmed) return trimmed;
    try {
      return new URL(t.url).hostname || t.url || "New tab";
    } catch {
      return t.url || "New tab";
    }
  };

  const onTabActivate = (tabId: string): void => {
    const ws = wsRef.current;
    if (!ws) return;
    sendWs(ws, { t: "tab_activate", tabId });
  };

  const onTabClose = (tabId: string, ev: { stopPropagation(): void }): void => {
    ev.stopPropagation();
    const ws = wsRef.current;
    if (!ws) return;
    sendWs(ws, { t: "tab_close", tabId });
  };

  const nav = (t: "back" | "forward" | "reload"): void => {
    const ws = wsRef.current;
    if (!ws) return;
    sendWs(ws, { t });
  };

  const chromeShell = anyChrome
    ? {
        borderRadius: fullScreen ? 0 : 10,
        overflow: "hidden" as const,
        border: fullScreen ? "none" : "1px solid #c4c7cc",
        boxShadow: fullScreen ? "none" : "0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)",
        maxWidth: fullScreen ? ("none" as const) : 1280,
        width: "100%",
        marginLeft: "auto",
        marginRight: "auto",
        background: "#dee1e6",
        fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
        ...(fullScreen
          ? {
              flex: 1,
              minHeight: 0,
              display: "flex" as const,
              flexDirection: "column" as const,
            }
          : {}),
      }
    : undefined;

  /** Letterboxed stage: matches session viewport aspect ratio, centered, max width capped. */
  const streamStage = (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#0b0d12",
        ...(fullScreen ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "100%",
          aspectRatio: `${viewport.w} / ${viewport.h}`,
          margin: "0 auto",
          ...(fullScreen
            ? {
                maxHeight: "100%",
                height: "auto",
                alignSelf: "center",
                flexShrink: 0,
              }
            : {}),
        }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={interactive ? 0 : -1}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
            border: anyChrome ? "none" : "1px solid #e5e7eb",
            borderRadius: anyChrome ? 0 : 8,
            background: "#0b0d12",
            outline: interactive && holder === "human" ? "2px solid #34d399" : undefined,
            touchAction: "none",
            userSelect: "none",
          }}
        />
      </div>
    </div>
  );

  const toolbarRow =
    resolvedChrome.showToolbar || resolvedChrome.showUrlBar ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          background: "#f1f3f4",
          borderBottom: anyChrome ? "1px solid #dadce0" : undefined,
        }}
      >
        {resolvedChrome.showToolbar ? (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              title="Back"
              aria-label="Back"
              onClick={() => nav("back")}
              style={navBtnStyle}
            >
              ←
            </button>
            <button
              type="button"
              title="Forward"
              aria-label="Forward"
              onClick={() => nav("forward")}
              style={navBtnStyle}
            >
              →
            </button>
            <button
              type="button"
              title="Reload"
              aria-label="Reload"
              onClick={() => nav("reload")}
              style={navBtnStyle}
            >
              ⟳
            </button>
          </div>
        ) : null}
        {resolvedChrome.showUrlBar ? (
          <div
            title={activeTitle || omniboxDisplay}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              background: "#fff",
              border: "1px solid #dadce0",
              borderRadius: 20,
              padding: "5px 14px",
              fontSize: 13,
              color: "#202124",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                userSelect: "text",
                cursor: "default",
              }}
            >
              {omniboxDisplay || " "}
            </span>
          </div>
        ) : null}
      </div>
    ) : null;

  const tabStrip =
    resolvedChrome.showTabStrip && tabs.length > 0 ? (
      <div
        role="tablist"
        aria-label="Tabs"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          padding: "4px 6px 0",
          background: "#dee1e6",
          borderBottom: "1px solid #bdc1c6",
          minHeight: 36,
        }}
      >
        {tabs.map((t) => {
          const active = t.active;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => onTabActivate(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onTabActivate(t.id);
                }
              }}
              tabIndex={0}
              style={{
                maxWidth: 200,
                minWidth: 72,
                padding: "6px 8px 8px",
                borderRadius: "8px 8px 0 0",
                background: active ? "#fff" : "#e8eaed",
                border: "1px solid #bdc1c6",
                borderBottom: active ? "1px solid #fff" : undefined,
                marginBottom: active ? -1 : 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#3c4043",
                zIndex: active ? 1 : 0,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {tabLabel(t)}
              </span>
              {tabs.length > 1 ? (
                <button
                  type="button"
                  title="Close tab"
                  aria-label={`Close ${tabLabel(t)}`}
                  onClick={(e) => onTabClose(t.id, e)}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: "0 2px",
                    cursor: "pointer",
                    borderRadius: 4,
                    lineHeight: 1,
                    color: "#5f6368",
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    ) : null;

  const webauthnToastLabel = (() => {
    if (!webauthnToast) return "";
    if (webauthnToast.rpId) return webauthnToast.rpId;
    if (webauthnToast.origin) {
      try {
        return new URL(webauthnToast.origin).hostname;
      } catch {
        return webauthnToast.origin;
      }
    }
    return "this site";
  })();

  const rootStyle: CSSProperties = {
    width: "100%",
    ...(fullScreen
      ? {
          height: "100%",
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0b0d12",
        }
      : {}),
    ...props.style,
  };

  const fullScreenBar = fullScreen ? (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        padding: "8px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "#12151c",
        fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <button
        type="button"
        onClick={exitFullScreen}
        style={{
          border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(255,255,255,0.06)",
          color: "#e5e7eb",
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Exit full screen
      </button>
    </div>
  ) : null;

  const statusLine = showSessionStatus ? (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        marginBottom: fullScreen ? 6 : 8,
        color: fullScreen ? "#9ca3af" : "#374151",
        flexShrink: 0,
      }}
    >
      Session {props.sessionId} — control: {holder} — {status}
      {interactive && holder === "human" ? (
        <span style={{ marginLeft: 8, color: fullScreen ? "#34d399" : "#059669" }}>
          (click canvas to focus, then type)
        </span>
      ) : null}
    </div>
  ) : null;

  const chromeBlock = (
    <div style={chromeShell}>
      {tabStrip}
      {toolbarRow}
      {streamStage}
    </div>
  );

  const noChromeBlock = (
    <div
      style={{
        width: "100%",
        maxWidth: fullScreen ? ("none" as const) : 1280,
        marginLeft: "auto",
        marginRight: "auto",
        ...(fullScreen
          ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" as const }
          : {}),
      }}
    >
      {streamStage}
    </div>
  );

  const main = (
    <>
      {statusLine}
      {anyChrome ? chromeBlock : noChromeBlock}
    </>
  );

  return (
    <div style={rootStyle}>
      {fullScreenBar}
      {fullScreen ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {main}
        </div>
      ) : (
        main
      )}
      {webauthnToast ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            maxWidth: 360,
            background: "#1f2937",
            color: "#f9fafb",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            padding: "10px 14px",
            fontSize: 13,
            lineHeight: 1.4,
            fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
            zIndex: 1000,
          }}
        >
          <strong style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
            Passkeys aren&rsquo;t available
          </strong>
          <span style={{ color: "#d1d5db" }}>
            {webauthnToastLabel} asked for a passkey. Pick a different sign-in option on the page
            (e.g. password, code).
          </span>
        </div>
      ) : null}
    </div>
  );
}

const navBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: "1px solid #dadce0",
  background: "#fff",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  color: "#5f6368",
};
