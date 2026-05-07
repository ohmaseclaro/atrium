import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteBrowser } from "./index.js";

type Listener = (ev: Event) => void;

class FakeWebSocket {
  static lastUrl = "";
  binaryType: BinaryType = "arraybuffer";
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(public url: string) {
    FakeWebSocket.lastUrl = url;
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

  send(): void {
    /* no-op for this smoke test */
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
});
