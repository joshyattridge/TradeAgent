import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next.config", () => {
  it("raises the proxy body size for large chat attachments", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("50mb");
  });
});
