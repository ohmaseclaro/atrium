import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ControlHolder } from "@atrium/protocol";

export type RemoteBrowserProps = {
  sessionId: string;
  viewerToken: string;
  wsUrl: string;
  onControlChange?: (holder: ControlHolder) => void;
  onTerminated?: (reason: string) => void;
  style?: CSSProperties;
};

/**
 * Minimal viewer: connects to the API WebSocket relay, renders JPEG frames to a canvas,
 * and surfaces control state. Toolbar chrome from the design doc ships in a later milestone.
 */
export function RemoteBrowser(props: RemoteBrowserProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "ended">("idle");
  const [holder, setHolder] = useState<ControlHolder>("agent");

  const connect = useCallback(() => {
    const url = new URL(props.wsUrl);
    url.searchParams.set("token", props.viewerToken);
    setStatus("connecting");
    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    let pendingFrame: ArrayBuffer | null = null;

    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data) as { t?: string; holder?: ControlHolder; reason?: string };
          if (msg.t === "hello") {
            setStatus("live");
          }
          if (msg.t === "control" && msg.holder) {
            setHolder(msg.holder);
            props.onControlChange?.(msg.holder);
          }
          if (msg.t === "frame") {
            pendingFrame = null;
          }
          if (msg.t === "bye") {
            setStatus("ended");
            props.onTerminated?.(msg.reason ?? "ended");
          }
        } catch {
          /* ignore */
        }
      } else if (ev.data instanceof ArrayBuffer) {
        pendingFrame = ev.data;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const blob = new Blob([pendingFrame], { type: "image/jpeg" });
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
  }, [props]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <div style={props.style}>
      <div
        style={{
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          marginBottom: 8,
          color: "#374151",
        }}
      >
        Session {props.sessionId} — control: {holder} — {status}
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          maxWidth: 1280,
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          background: "#0b0d12",
        }}
      />
    </div>
  );
}
