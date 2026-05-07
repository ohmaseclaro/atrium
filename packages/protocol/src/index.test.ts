import { describe, expect, it } from "vitest";
import {
  clientMessageSchema,
  parseClientMessage,
  parseServerMessage,
  serverMessageSchema,
  sessionBootstrapBodySchema,
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

describe("sessionBootstrapBodySchema (clientCertificates)", () => {
  it("accepts a PEM cert+key pair", () => {
    const parsed = sessionBootstrapBodySchema.parse({
      clientCertificates: [
        {
          origin: "https://bank.example.com",
          certBase64: "Y2VydA==",
          keyBase64: "a2V5",
        },
      ],
    });
    expect(parsed.clientCertificates?.[0].origin).toBe("https://bank.example.com");
  });

  it("accepts a PFX bundle with passphrase", () => {
    const parsed = sessionBootstrapBodySchema.parse({
      clientCertificates: [
        {
          origin: "https://api.example.com",
          pfxBase64: "cGZ4",
          passphrase: "s3cret",
        },
      ],
    });
    expect(parsed.clientCertificates?.[0].pfxBase64).toBe("cGZ4");
  });

  it("rejects an entry with neither PEM nor PFX", () => {
    expect(() =>
      sessionBootstrapBodySchema.parse({
        clientCertificates: [{ origin: "https://example.com" }],
      }),
    ).toThrow();
  });

  it("rejects an entry with a PEM cert but no key", () => {
    expect(() =>
      sessionBootstrapBodySchema.parse({
        clientCertificates: [{ origin: "https://example.com", certBase64: "Y2VydA==" }],
      }),
    ).toThrow();
  });
});
