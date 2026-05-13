import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ClientMessage, ControlHolder } from "@atriumjs/protocol";
import { parseServerMessage } from "@atriumjs/protocol";

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
  /**
   * Called when an internal error happens that the component would otherwise swallow —
   * malformed wire messages, image-decode failures, reconnect exhaustion, etc.
   * Use this for telemetry; UX is already handled inline.
   */
  onError?: (err: unknown) => void;
  style?: CSSProperties;
  /**
   * When true, stretches to fill the parent (use a parent with `height: 100%` inside a fullscreen element).
   * Renders a top bar with **Exit full screen** that calls `document.exitFullscreen()` when active, then `onExitFullScreen`.
   * For reliable fullscreen, call `element.requestFullscreen()` from the same user gesture that shows this tree (before awaiting network).
   */
  fullScreen?: boolean;
  onExitFullScreen?: () => void;
  /**
   * Called whenever the internal WebSocket connection status changes.
   * Useful for driving stage-aware loading copy in the host UI.
   */
  onStatusChange?: (status: "idle" | "connecting" | "live" | "reconnecting" | "ended") => void;
  /**
   * Controls the built-in "Connecting…" overlay shown while the WebSocket is
   * establishing and while waiting for the first frame from the worker.
   * - `"auto"` (default) — overlay is shown automatically.
   * - `"none"` — disable; host UI is responsible for its own loading state.
   */
  connectingOverlay?: "auto" | "none";
};

export type RemoteBrowserHandle = {
  /** Drop the WebSocket and open a fresh transport (exponential backoff applies). */
  reconnect: () => void;
  /** Navigate the remote browser to a URL. */
  navigate: (url: string) => void;
  /** History back. */
  back: () => void;
  /** History forward. */
  forward: () => void;
  /** Reload the current page. */
  reload: () => void;
  /** Ask the server to grant control to the human. */
  requestControl: () => void;
  /** Ask the server to return control to the agent. */
  releaseControl: () => void;
};

function sendWs(ws: WebSocket, msg: ClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * WebSocket marked as intentionally closed by the component (unmount or
 * imperative `reconnect`). The close handler reads this per-socket flag, which
 * sidesteps the race where a *new* socket failure could be misread as
 * intentional because a prior shared flag was still set.
 */
type AtriumWebSocket = WebSocket & { __atriumIntentional?: boolean };
function markIntentionalClose(ws: WebSocket | null | undefined): void {
  if (!ws) return;
  (ws as AtriumWebSocket).__atriumIntentional = true;
  try {
    ws.close();
  } catch {
    /* already closed */
  }
}

/** Escapes a string for use in a CSS attribute selector. Falls back to a manual escape on older browsers. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/**
 * Remote browser viewer: WebSocket relay, JPEG frames on canvas, optional embedded-Chrome-style UI.
 */
export const RemoteBrowser = forwardRef<RemoteBrowserHandle, RemoteBrowserProps>(
  function RemoteBrowser(props, ref): JSX.Element {
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
    const onErrorRef = useRef(props.onError);
    const onStatusChangeRef = useRef(props.onStatusChange);
    const webauthnNoticeRef = useRef(webauthnNotice);
    const [status, setStatus] = useState<"idle" | "connecting" | "live" | "reconnecting" | "ended">(
      "idle",
    );
    const setStatusAndNotify = useCallback(
      (next: "idle" | "connecting" | "live" | "reconnecting" | "ended") => {
        setStatus(next);
        onStatusChangeRef.current?.(next);
      },
      [],
    );
    /** True once the first JPEG frame has been painted — used to gate the connecting overlay. */
    const [firstFrame, setFirstFrame] = useState(false);
    const [holder, setHolder] = useState<ControlHolder>("agent");
    const [viewport, setViewport] = useState({ w: 1280, h: 800 });
    const [tabs, setTabs] = useState<RemoteBrowserTab[]>([]);
    const [activeUrl, setActiveUrl] = useState("");
    const [activeTitle, setActiveTitle] = useState("");
    const [remoteCursor, setRemoteCursor] = useState<string | null>(null);
    const [remoteFavicon, setRemoteFavicon] = useState<string | null>(null);
    const [remoteLoading, setRemoteLoading] = useState(false);
    const [webauthnToast, setWebauthnToast] = useState<WebAuthnRequest | null>(null);
    const webauthnToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
      onControlChangeRef.current = props.onControlChange;
      onTerminatedRef.current = props.onTerminated;
      onWebAuthnRequestRef.current = props.onWebAuthnRequest;
      onErrorRef.current = props.onError;
      onStatusChangeRef.current = props.onStatusChange;
      // Keep the toast preference in a ref so toggling it doesn't tear down the WebSocket
      // (the property only affects whether we render a toast; not connection lifecycle).
      webauthnNoticeRef.current = webauthnNotice;
    }, [
      props.onControlChange,
      props.onTerminated,
      props.onWebAuthnRequest,
      props.onError,
      props.onStatusChange,
      webauthnNotice,
    ]);

    const onExitFullScreenRef = useRef(props.onExitFullScreen);
    useEffect(() => {
      onExitFullScreenRef.current = props.onExitFullScreen;
    }, [props.onExitFullScreen]);

    const exitFullScreen = useCallback(() => {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
      onExitFullScreenRef.current?.();
    }, []);

    const sessionEndedRef = useRef(false);
    const connectRef = useRef<() => void>(() => undefined);

    const connect = useCallback(() => {
      const url = new URL(props.wsUrl);
      url.searchParams.set("token", props.viewerToken);
      const attempt = reconnectAttemptRef.current;
      setStatusAndNotify(attempt > 0 ? "reconnecting" : "connecting");
      sessionEndedRef.current = false;

      if (attempt === 0) {
        setHolder("agent");
        setViewport({ w: 1280, h: 800 });
        setTabs([]);
        setActiveUrl("");
        setActiveTitle("");
        setRemoteCursor(null);
        setRemoteFavicon(null);
        setRemoteLoading(false);
        setWebauthnToast(null);
        setFirstFrame(false);
        if (webauthnToastTimerRef.current) {
          clearTimeout(webauthnToastTimerRef.current);
          webauthnToastTimerRef.current = null;
        }
        const canvas = canvasRef.current;
        if (canvas) {
          // eslint-disable-next-line no-self-assign
          canvas.width = canvas.width;
        }
      }

      const ws = new WebSocket(url.toString());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.addEventListener("message", (ev) => {
        if (typeof ev.data === "string") {
          try {
            const msg = parseServerMessage(JSON.parse(ev.data));
            if (msg.t === "hello") {
              reconnectAttemptRef.current = 0;
              setStatusAndNotify("live");
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
            if (msg.t === "loading") {
              setRemoteLoading(msg.loading);
            }
            if (msg.t === "cursor") {
              setRemoteCursor(msg.cursor);
            }
            if (msg.t === "favicon") {
              setRemoteFavicon(msg.href);
            }
            if (msg.t === "pong") {
              /* keepalive */
            }
            if (msg.t === "webauthn_required") {
              const req: WebAuthnRequest = {
                id: msg.id,
                ceremony: msg.ceremony,
                rpId: msg.rpId,
                origin: msg.origin,
              };
              onWebAuthnRequestRef.current?.(req);
              if (webauthnNoticeRef.current) {
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
              sessionEndedRef.current = true;
              setStatusAndNotify("ended");
              onTerminatedRef.current?.(msg.reason);
            }
            if (msg.t === "clipboard" && msg.text) {
              // Worker → viewer: the remote page produced clipboard text from a copy/cut.
              // Try to put it on the user's local clipboard. `writeText` may reject when
              // the document is not focused, the page is on insecure HTTP, or the user has
              // denied clipboard permissions. We surface to onError so consumers can
              // show their own "click to copy" affordance.
              const cb = navigator.clipboard;
              if (cb && typeof cb.writeText === "function") {
                void cb.writeText(msg.text).catch((err) => {
                  onErrorRef.current?.(err);
                });
              } else {
                onErrorRef.current?.(new Error("clipboard_api_unavailable"));
              }
            }
          } catch (err) {
            onErrorRef.current?.(err);
          }
        } else if (ev.data instanceof ArrayBuffer) {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          setFirstFrame(true);
          const blob = new Blob([ev.data], { type: "image/jpeg" });
          const img = new Image();
          const objectUrl = URL.createObjectURL(blob);
          let revoked = false;
          const revokeOnce = (): void => {
            if (revoked) return;
            revoked = true;
            URL.revokeObjectURL(objectUrl);
          };
          img.onload = () => {
            try {
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              ctx.drawImage(img, 0, 0);
            } catch (err) {
              onErrorRef.current?.(err);
            } finally {
              revokeOnce();
            }
          };
          img.onerror = (err) => {
            onErrorRef.current?.(err);
            revokeOnce();
          };
          img.src = objectUrl;
        }
      });

      ws.addEventListener("open", () => {
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            sendWs(ws, { t: "ping" });
          }
        }, 20_000);
      });

      ws.addEventListener("close", () => {
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        // Per-socket intentional flag — set before close by reconnect() / unmount.
        // Reading off the local `ws` (captured by closure) avoids the race where a
        // new socket's close was misread as intentional because of a stale shared flag.
        if ((ws as AtriumWebSocket).__atriumIntentional) {
          return;
        }
        if (sessionEndedRef.current) {
          return;
        }
        reconnectAttemptRef.current += 1;
        const n = reconnectAttemptRef.current;
        if (n > 24) {
          setStatusAndNotify("ended");
          onErrorRef.current?.(new Error("reconnect_exhausted"));
          onTerminatedRef.current?.("reconnect_exhausted");
          return;
        }
        const delay = Math.min(30_000, 500 * 2 ** Math.min(n - 1, 8));
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectRef.current();
        }, delay);
      });
    }, [props.viewerToken, props.wsUrl, setStatusAndNotify]);

    useEffect(() => {
      connectRef.current = connect;
    }, [connect]);

    useImperativeHandle(
      ref,
      () => ({
        reconnect: () => {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          reconnectAttemptRef.current = 0;
          sessionEndedRef.current = false;
          // Tag the OLD socket as intentional so its `close` handler skips backoff.
          // The NEW socket from `connect()` does NOT carry the flag, so a real failure
          // on it triggers backoff as expected.
          markIntentionalClose(wsRef.current);
          connect();
        },
        navigate: (url: string) => {
          const ws = wsRef.current;
          if (!ws) return;
          sendWs(ws, { t: "navigate", url });
        },
        back: () => {
          const ws = wsRef.current;
          if (!ws) return;
          sendWs(ws, { t: "back" });
        },
        forward: () => {
          const ws = wsRef.current;
          if (!ws) return;
          sendWs(ws, { t: "forward" });
        },
        reload: () => {
          const ws = wsRef.current;
          if (!ws) return;
          sendWs(ws, { t: "reload" });
        },
        requestControl: () => {
          const ws = wsRef.current;
          if (!ws) return;
          sendWs(ws, { t: "request_control" });
        },
        releaseControl: () => {
          const ws = wsRef.current;
          if (!ws) return;
          sendWs(ws, { t: "release_control" });
        },
      }),
      [connect],
    );

    useEffect(() => {
      reconnectAttemptRef.current = 0;
      connect();
      return () => {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        markIntentionalClose(wsRef.current);
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
        // Make sure subsequent key chords (Cmd/Ctrl+V, etc.) target the canvas.
        // Without focus, keydown listeners on the canvas never fire.
        try {
          canvas.focus({ preventScroll: true });
        } catch {
          canvas.focus();
        }
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
        // Scale wheel deltas from local display dimensions to the remote viewport,
        // so a trackpad pixel on a 4K Mac doesn't scroll a 1280×800 viewport at 3×.
        const rect = canvas.getBoundingClientRect();
        const dispW = Math.max(rect.width, 1);
        const dispH = Math.max(rect.height, 1);
        const sx = viewport.w / dispW;
        const sy = viewport.h / dispH;
        // `deltaMode` units: 0=pixels (1), 1=lines (~16px), 2=pages (display dim per page).
        // Per axis: a horizontal page is `dispW`, a vertical page is `dispH`.
        const unitX = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? dispW : 1;
        const unitY = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? dispH : 1;
        sendWs(ws, {
          t: "input",
          kind: "wheel",
          payload: {
            deltaX: ev.deltaX * unitX * sx,
            deltaY: ev.deltaY * unitY * sy,
          },
        });
      };

      // Right-click: prevent the browser's native context menu and forward as a
      // mouse-down/up pair with button === 2 so the remote page sees the gesture.
      const onContextMenu = (ev: MouseEvent): void => {
        ev.preventDefault();
      };

      const maxClipboardChars = 200_000;
      const sendPasteText = (text: string): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const t = text.slice(0, maxClipboardChars);
        if (!t) return;
        sendWs(ws, { t: "input", kind: "clipboard", payload: { action: "paste", text: t } });
      };

      /**
       * Read the user's local clipboard. Browsers only fire `paste` on editable targets,
       * so on a `<canvas>` the only reliable path is `navigator.clipboard.readText()`.
       * It needs HTTPS + a recent user gesture (the keydown chord is the gesture).
       * Failures (insecure context, denied permission, unsupported browser) are surfaced
       * via `onError` so the host can prompt the user to retry or paste through the menu.
       */
      const readLocalClipboardAndPaste = (): void => {
        const cb = navigator.clipboard;
        if (cb && typeof cb.readText === "function") {
          void cb
            .readText()
            .then(sendPasteText)
            .catch((err) => {
              onErrorRef.current?.(err);
            });
        } else {
          onErrorRef.current?.(new Error("clipboard_api_unavailable"));
        }
      };

      /** Fallback path: some browsers do fire `paste` on focused tabIndex'd elements. */
      const onDocumentPaste = (ev: ClipboardEvent): void => {
        if (document.activeElement !== canvas) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        const fromEvent = ev.clipboardData?.getData("text/plain") ?? "";
        if (!fromEvent) return;
        ev.preventDefault();
        sendPasteText(fromEvent);
      };

      const accel = (ev: KeyboardEvent): boolean => ev.ctrlKey || ev.metaKey;
      const isPasteChord = (ev: KeyboardEvent): boolean =>
        accel(ev) && (ev.key === "v" || ev.key === "V");
      const isCopyChord = (ev: KeyboardEvent): boolean =>
        accel(ev) && (ev.key === "c" || ev.key === "C");
      const isCutChord = (ev: KeyboardEvent): boolean =>
        accel(ev) && (ev.key === "x" || ev.key === "X");

      const onKeyDown = (ev: KeyboardEvent): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ev.target !== canvas) return;
        // Suppress keystrokes that are part of an active IME composition.
        // `compositionstart/update/end` carry the actual user-visible text via the
        // `ime` channel. Forwarding these as raw key events double-fires CJK input.
        if (ev.isComposing || ev.keyCode === 229 || ev.key === "Process") {
          ev.preventDefault();
          return;
        }
        if (isPasteChord(ev)) {
          ev.preventDefault();
          readLocalClipboardAndPaste();
          return;
        }
        if (ev.key === "Insert" && ev.shiftKey) {
          ev.preventDefault();
          readLocalClipboardAndPaste();
          return;
        }
        if (isCopyChord(ev)) {
          ev.preventDefault();
          sendWs(ws, { t: "input", kind: "clipboard", payload: { action: "copy" } });
          return;
        }
        if (isCutChord(ev)) {
          ev.preventDefault();
          sendWs(ws, { t: "input", kind: "clipboard", payload: { action: "cut" } });
          return;
        }
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
        if (ev.isComposing || ev.keyCode === 229 || ev.key === "Process") {
          ev.preventDefault();
          return;
        }
        if (isPasteChord(ev) || isCopyChord(ev) || isCutChord(ev)) {
          ev.preventDefault();
          return;
        }
        ev.preventDefault();
        sendWs(ws, {
          t: "input",
          kind: "key",
          payload: { type: "up", key: ev.key, code: ev.code },
        });
      };

      const releaseAllModifiers = (): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        for (const code of [
          "MetaLeft",
          "MetaRight",
          "ControlLeft",
          "ControlRight",
          "ShiftLeft",
          "ShiftRight",
          "AltLeft",
          "AltRight",
        ] as const) {
          sendWs(ws, { t: "input", kind: "key", payload: { type: "up", key: "", code } });
        }
      };

      const onWinBlur = (): void => {
        releaseAllModifiers();
      };
      const onVis = (): void => {
        if (document.visibilityState === "hidden") releaseAllModifiers();
      };

      const onPointerCancel = (): void => {
        releaseAllModifiers();
      };

      const onCompStart = (e: CompositionEvent): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        sendWs(ws, { t: "ime", text: e.data ?? "", isComposing: true });
      };
      const onCompUpdate = (e: CompositionEvent): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        sendWs(ws, { t: "ime", text: e.data ?? "", isComposing: true });
      };
      const onCompEnd = (e: CompositionEvent): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        sendWs(ws, { t: "ime", text: e.data ?? "", isComposing: false });
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointercancel", onPointerCancel);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", onContextMenu);
      canvas.addEventListener("keydown", onKeyDown);
      canvas.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("compositionstart", onCompStart);
      canvas.addEventListener("compositionupdate", onCompUpdate);
      canvas.addEventListener("compositionend", onCompEnd);
      document.addEventListener("paste", onDocumentPaste, true);
      window.addEventListener("blur", onWinBlur);
      document.addEventListener("visibilitychange", onVis);

      return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("contextmenu", onContextMenu);
        canvas.removeEventListener("keydown", onKeyDown);
        canvas.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("compositionstart", onCompStart);
        canvas.removeEventListener("compositionupdate", onCompUpdate);
        canvas.removeEventListener("compositionend", onCompEnd);
        document.removeEventListener("paste", onDocumentPaste, true);
        window.removeEventListener("blur", onWinBlur);
        document.removeEventListener("visibilitychange", onVis);
      };
    }, [interactive, holder, status, viewport.w, viewport.h]);

    /**
     * Mirror the remote page's CSS cursor onto the canvas so the user sees text/pointer/grab
     * affordances over inputs, links, and draggable elements.
     */
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.style.cursor = remoteCursor && remoteCursor.length > 0 ? remoteCursor : "";
    }, [remoteCursor]);

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
          boxShadow: fullScreen
            ? "none"
            : "0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)",
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
          id="atrium-remote-panel"
          role="tabpanel"
          aria-label="Remote browser content"
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
          <div
            aria-live="polite"
            aria-atomic="true"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0,0,0,0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            {/* Mirror the visible pill's gating so screen readers don't claim a holder
                before `hello` arrives. Pre-live status announces a connection state. */}
            {status === "live"
              ? `${
                  holder === "human"
                    ? "You have control."
                    : holder === "agent"
                      ? "Automation has control."
                      : "Idle."
                }${remoteLoading ? " Page is loading." : ""}`
              : status === "reconnecting"
                ? "Reconnecting to the remote browser."
                : status === "ended"
                  ? "Remote browser session ended."
                  : "Connecting to the remote browser."}
          </div>
          {status === "reconnecting" ? (
            <div
              role="status"
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                zIndex: 3,
                background: "rgba(15,23,42,0.88)",
                color: "#e5e7eb",
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              Reconnecting…
            </div>
          ) : null}
          {props.connectingOverlay !== "none" &&
          (status === "connecting" || status === "idle" || (status === "live" && !firstFrame)) ? (
            <div
              role="status"
              aria-label="Connecting to remote browser"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                background: "#0b0d12",
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "3px solid rgba(148,163,184,0.2)",
                  borderTopColor: "#38bdf8",
                  animation: "atrium-spin 0.85s linear infinite",
                }}
              />
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "#94a3b8",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {status === "live" ? "Loading page…" : "Connecting to remote browser…"}
              </p>
              <style>{`@keyframes atrium-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : null}
          {remoteLoading ? (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                zIndex: 4,
                background: "rgba(15,23,42,0.18)",
                overflow: "hidden",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "40%",
                  background: "#22d3ee",
                  borderRadius: 2,
                  animation: "atrium-loading-bar 1.2s linear infinite",
                }}
              />
              <style>{`@keyframes atrium-loading-bar {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(250%); }
              }`}</style>
            </div>
          ) : null}
          {status === "live" ? (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: 10,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 2,
                background: "rgba(15,23,42,0.82)",
                color: "#f9fafb",
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontFamily: "system-ui, sans-serif",
                pointerEvents: "none",
                maxWidth: "90%",
                textAlign: "center",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {remoteFavicon ? (
                <img src={remoteFavicon} alt="" style={{ width: 14, height: 14, flexShrink: 0 }} />
              ) : null}
              <span>
                {holder === "human"
                  ? "You have control"
                  : holder === "agent"
                    ? "Automation in control"
                    : "Idle"}
                {remoteLoading ? " · Loading" : ""}
              </span>
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            tabIndex={interactive ? 0 : -1}
            aria-label="Remote browser stream"
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
                gap: 8,
                background: "#fff",
                border: "1px solid #dadce0",
                borderRadius: 20,
                padding: "5px 14px",
                fontSize: 13,
                color: "#202124",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              {remoteFavicon ? (
                <img src={remoteFavicon} alt="" style={{ width: 14, height: 14, flexShrink: 0 }} />
              ) : null}
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

    /**
     * WAI-ARIA tablist with **roving tabindex** (only one tab in tab order at a time)
     * and **manual activation** (ArrowLeft/Right moves focus, Enter/Space activates).
     */
    const focusTab = (tabId: string): void => {
      const root = document.getElementById("atrium-tablist");
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`[data-atrium-tab-id="${cssEscape(tabId)}"]`);
      el?.focus();
    };

    const tabStrip =
      resolvedChrome.showTabStrip && tabs.length > 0 ? (
        <div
          id="atrium-tablist"
          role="tablist"
          aria-label="Tabs"
          aria-controls="atrium-remote-panel"
          onKeyDown={(e) => {
            if (
              e.key !== "ArrowLeft" &&
              e.key !== "ArrowRight" &&
              e.key !== "Home" &&
              e.key !== "End"
            )
              return;
            e.preventDefault();
            const focusedId =
              (document.activeElement as HTMLElement | null)?.getAttribute("data-atrium-tab-id") ??
              null;
            const idx = focusedId
              ? tabs.findIndex((t) => t.id === focusedId)
              : tabs.findIndex((t) => t.active);
            if (idx < 0) return;
            let next: RemoteBrowserTab | undefined;
            if (e.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
            else if (e.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
            else if (e.key === "Home") next = tabs[0];
            else if (e.key === "End") next = tabs[tabs.length - 1];
            if (next) focusTab(next.id);
          }}
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
                data-atrium-tab-id={t.id}
                onClick={() => onTabActivate(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onTabActivate(t.id);
                  } else if (e.key === "Delete" && tabs.length > 1) {
                    e.preventDefault();
                    onTabClose(t.id, e);
                  }
                }}
                tabIndex={active ? 0 : -1}
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
                {active && remoteFavicon ? (
                  <img
                    src={remoteFavicon}
                    alt=""
                    style={{ width: 14, height: 14, flexShrink: 0 }}
                  />
                ) : null}
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
                    tabIndex={-1}
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
  },
);

/** Minimal session tuple helper for hosts that manage session state outside `RemoteBrowser`. */
export function useRemoteBrowserSession(initial: {
  sessionId: string;
  viewerToken: string;
  wsUrl: string;
}): [
  { sessionId: string; viewerToken: string; wsUrl: string },
  (patch: Partial<{ sessionId: string; viewerToken: string; wsUrl: string }>) => void,
] {
  const [s, setS] = useState(initial);
  const patch = useCallback((p: Partial<typeof initial>) => {
    setS((prev) => ({ ...prev, ...p }));
  }, []);
  // Memoize the tuple so consumers passing it through context / props don't
  // see a fresh array identity every render.
  return useMemo(() => [s, patch], [s, patch]);
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
