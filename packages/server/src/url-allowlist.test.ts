import { describe, expect, it } from "vitest";
import { urlAllowed } from "./url-allowlist.js";

describe("urlAllowed", () => {
  it("allows all when pattern is *", () => {
    expect(urlAllowed("https://evil.test/path", ["*"])).toBe(true);
  });

  it("matches prefix patterns ending with *", () => {
    expect(urlAllowed("https://example.com/foo", ["https://example.com/*"])).toBe(true);
    expect(urlAllowed("https://other.com/", ["https://example.com/*"])).toBe(false);
  });

  it("returns false for empty pattern list", () => {
    expect(urlAllowed("https://a.com/", [])).toBe(false);
  });
});
