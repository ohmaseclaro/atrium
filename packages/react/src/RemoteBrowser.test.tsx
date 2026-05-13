import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteBrowser, type RemoteBrowserHandle } from "./index.js";

type Listener = (ev: Event) => void;

class FakeWebSocket {
  static lastUrl = "";
  static last: FakeWebSocket | null = null;
  static OPEN = 1;
  binaryType: BinaryType = "arraybuffer";
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(public url: string) {
    FakeWebSocket.lastUrl = url;
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.dispatch("open", new Event("open"));
      this.dispatch(
        "message",
        new MessageEvent("message", {
          data: JSON.stringify({
            t: "hello",
            sessionId: "sid",
            control: { holder: "agent", since: 1 },
            viewport: { w: 800, h: 600 },
          }),
        }),
      );
    });
  }

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  dispatch(type: string, ev: Event): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(ev);
    }
  }

  emitMessage(payload: unknown): void {
    this.dispatch("message", new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.dispatch("close", new Event("close"));
  }
}

describe("RemoteBrowser", () => {
  const Original = globalThis.WebSocket;

  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.stubGlobal("WebSocket", Original);
  });

  it("opens a websocket with token query and renders session metadata", async () => {
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.lastUrl).toContain("token=tok");
      expect(FakeWebSocket.lastUrl).toContain("/atrium/sessions/sid/stream");
    });

    await waitFor(() => {
      expect(screen.getByText(/Session sid/)).toBeInTheDocument();
    });
  });

  it("with chrome=minimal hides default session line and shows navigation toolbar", async () => {
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        chrome="minimal"
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Session sid/)).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("fullScreen shows an exit control bar", async () => {
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        fullScreen
        chrome="minimal"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
    });
  });

  it("custom chrome can enable only the tab strip", async () => {
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        chrome={{ showTabStrip: true, showToolbar: false, showUrlBar: false }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Session sid/)).not.toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
  });

  it("shows a non-blocking passkey toast on webauthn_required", async () => {
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        connectingOverlay="none"
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    act(() => {
      FakeWebSocket.last!.emitMessage({
        t: "webauthn_required",
        id: "req-1",
        ceremony: "get",
        rpId: "google.com",
        origin: "https://accounts.google.com",
      });
    });

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/Passkeys aren.t available/);
    expect(toast).toHaveTextContent(/google\.com asked for a passkey/);
    /** No buttons, no dialog — purely informational. */
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in/ })).not.toBeInTheDocument();
  });

  it("calls onError when a malformed server message arrives", async () => {
    const seen: unknown[] = [];
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        onError={(e) => seen.push(e)}
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    act(() => {
      FakeWebSocket.last!.dispatch(
        "message",
        new MessageEvent("message", { data: "{not valid json" }),
      );
    });

    await waitFor(() => {
      expect(seen.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("imperative handle exposes navigate / back / forward / reload / control methods", async () => {
    const ref = createRef<RemoteBrowserHandle>();
    render(
      <RemoteBrowser
        ref={ref}
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    const ws = FakeWebSocket.last!;
    act(() => {
      ref.current!.navigate("https://example.com/");
      ref.current!.back();
      ref.current!.forward();
      ref.current!.reload();
      ref.current!.requestControl();
      ref.current!.releaseControl();
    });

    const sent = ws.sent.map((s) => JSON.parse(s) as { t: string; url?: string });
    expect(sent).toEqual(
      expect.arrayContaining([
        { t: "navigate", url: "https://example.com/" },
        { t: "back" },
        { t: "forward" },
        { t: "reload" },
        { t: "request_control" },
        { t: "release_control" },
      ]),
    );
  });

  it("renders an animated loading bar on { t: 'loading', loading: true }", async () => {
    const { container } = render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        connectingOverlay="none"
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    expect(container.textContent).not.toMatch(/loading/i);

    act(() => {
      FakeWebSocket.last!.emitMessage({ t: "loading", loading: true });
    });

    await waitFor(() => {
      expect(container.textContent).toMatch(/Loading/);
    });
  });

  it("applies remote cursor to the canvas style", async () => {
    const { container } = render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    act(() => {
      FakeWebSocket.last!.emitMessage({ t: "cursor", cursor: "text" });
    });

    await waitFor(() => {
      const canvas = container.querySelector("canvas");
      expect(canvas?.style.cursor).toBe("text");
    });
  });

  it("prevents the native context menu on the canvas", async () => {
    const { container } = render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        interactive
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    // Promote to "human" so the input listeners attach.
    act(() => {
      FakeWebSocket.last!.emitMessage({ t: "control", holder: "human" });
    });

    const canvas = container.querySelector("canvas")!;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("forwards composition events as { t: 'ime' } messages", async () => {
    const { container } = render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        interactive
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    act(() => {
      FakeWebSocket.last!.emitMessage({ t: "control", holder: "human" });
    });

    const ws = FakeWebSocket.last!;
    const canvas = container.querySelector("canvas")!;

    fireEvent.compositionStart(canvas, { data: "" });
    fireEvent.compositionUpdate(canvas, { data: "あ" });
    fireEvent.compositionEnd(canvas, { data: "あい" });

    const ime = ws.sent
      .map((s) => JSON.parse(s) as { t: string; text?: string; isComposing?: boolean })
      .filter((m) => m.t === "ime");
    expect(ime.length).toBe(3);
    expect(ime[2]).toEqual({ t: "ime", text: "あい", isComposing: false });
  });

  it("flushes held modifiers on window blur", async () => {
    const { container } = render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        interactive
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    act(() => {
      FakeWebSocket.last!.emitMessage({ t: "control", holder: "human" });
    });

    // Force the input-listeners effect to attach (it requires a canvas).
    expect(container.querySelector("canvas")).toBeTruthy();

    const ws = FakeWebSocket.last!;
    const before = ws.sent.length;

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    const flushed = ws.sent
      .slice(before)
      .map((s) => JSON.parse(s) as { t: string; kind?: string; payload?: { code?: string } })
      .filter((m) => m.t === "input" && m.kind === "key");

    const codes = flushed.map((m) => m.payload?.code).sort();
    expect(codes).toEqual(
      [
        "AltLeft",
        "AltRight",
        "ControlLeft",
        "ControlRight",
        "MetaLeft",
        "MetaRight",
        "ShiftLeft",
        "ShiftRight",
      ].sort(),
    );
  });

  it("notifies onWebAuthnRequest and stays silent when webauthnNotice={false}", async () => {
    const seen: string[] = [];
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        webauthnNotice={false}
        connectingOverlay="none"
        onWebAuthnRequest={(req) => seen.push(req.rpId ?? "")}
      />,
    );

    await waitFor(() => {
      expect(FakeWebSocket.last).not.toBeNull();
    });

    act(() => {
      FakeWebSocket.last!.emitMessage({
        t: "webauthn_required",
        id: "auto-1",
        ceremony: "get",
        rpId: "x.com",
      });
    });

    await waitFor(() => {
      expect(seen).toContain("x.com");
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
