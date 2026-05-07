import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteBrowser } from "./index.js";

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

  it("notifies onWebAuthnRequest and stays silent when webauthnNotice={false}", async () => {
    const seen: string[] = [];
    render(
      <RemoteBrowser
        sessionId="sid"
        viewerToken="tok"
        wsUrl="ws://127.0.0.1:1/atrium/sessions/sid/stream"
        webauthnNotice={false}
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
