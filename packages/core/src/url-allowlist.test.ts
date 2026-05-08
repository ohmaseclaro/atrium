import { describe, expect, it } from "vitest";
import { urlAllowed } from "./url-allowlist.js";

describe("urlAllowed", () => {
  it("allows star pattern", () => {
    expect(urlAllowed("https://evil.test/phish", ["*"])).toBe(true);
  });

  it("rejects when list empty", () => {
    expect(urlAllowed("https://a.com/", [])).toBe(false);
  });

  it("matches prefix patterns", () => {
    expect(
      urlAllowed("https://accounts.google.com/o/oauth2", ["https://accounts.google.com/*"]),
    ).toBe(true);
    expect(urlAllowed("https://evil.google.com/", ["https://accounts.google.com/*"])).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(urlAllowed("not a url", ["https://a.com/*"])).toBe(false);
  });
});
