import { describe, expect, it } from "vitest";
import { viewerStreamMatch } from "./streaming.js";

describe("viewerStreamMatch", () => {
  it("parses stream path", () => {
    expect(viewerStreamMatch("/atrium", "/atrium/sessions/abc/stream")).toEqual({
      sessionId: "abc",
    });
  });

  it("returns undefined for bad paths", () => {
    expect(viewerStreamMatch("/atrium", "/atrium/sessions/a/b/stream")).toBeUndefined();
  });
});
