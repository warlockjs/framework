import { describe, expect, it } from "vitest";
import { webRootStub } from "./stubs";

describe("warlock add web root.tsx stub", () => {
  it("renders the hydration mount @warlock.js/web looks up (#vessel since 5.14)", () => {
    expect(webRootStub).toContain('<div id="vessel">{children}</div>');
    expect(webRootStub).not.toContain('id="root"');
  });

  it("leaves the viewport tag to <Head /> instead of hand-writing a second one", () => {
    const code = webRootStub.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    expect(code).toContain("<Head />");
    expect(code).not.toMatch(/<meta\s+name="viewport"/);
  });
});
