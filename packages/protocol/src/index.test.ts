import { describe, expect, it } from "vitest";
import {
  clientMessageSchema,
  parseClientMessage,
  parseServerMessage,
  serverMessageSchema,
  sessionStatusSchema,
} from "./index.js";

describe("sessionStatusSchema", () => {
  it("accepts known lifecycle values", () => {
    for (const v of sessionStatusSchema.options) {
      expect(sessionStatusSchema.parse(v)).toBe(v);
    }
  });

  it("rejects unknown status strings", () => {
    expect(() => sessionStatusSchema.parse("not-a-status")).toThrow();
  });
});

describe("serverMessageSchema", () => {
  it("parses hello envelope", () => {
    const msg = serverMessageSchema.parse({
      t: "hello",
      sessionId: "sid",
      control: { holder: "agent", since: 1 },
      viewport: { w: 1280, h: 800 },
    });
    expect(msg.t).toBe("hello");
  });

  it("parses frame header", () => {
    const msg = serverMessageSchema.parse({
      t: "frame",
      seq: 1,
      ts: 2,
      mime: "image/jpeg",
    });
    expect(msg.mime).toBe("image/jpeg");
  });
});

describe("parseServerMessage", () => {
  it("throws on invalid payloads", () => {
    expect(() => parseServerMessage({ t: "frame", seq: "x" })).toThrow();
  });
});

describe("clientMessageSchema", () => {
  it("parses ping", () => {
    expect(clientMessageSchema.parse({ t: "ping" }).t).toBe("ping");
  });
});

describe("parseClientMessage", () => {
  it("throws on malformed input", () => {
    expect(() => parseClientMessage({ t: "nope" })).toThrow();
  });
});
