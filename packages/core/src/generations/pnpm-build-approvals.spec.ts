import { describe, expect, it } from "vitest";
import { mergePnpmSharpApproval } from "./pnpm-build-approvals";

describe("pnpm image feature build approval", () => {
  it("adds sharp beside existing approvals and replaces an undecided placeholder", () => {
    expect(mergePnpmSharpApproval("allowBuilds:\n  esbuild: true\n")).toBe(
      "allowBuilds:\n  sharp: true\n  esbuild: true\n",
    );
    expect(
      mergePnpmSharpApproval("allowBuilds:\n  sharp: set this to true or false # generated\n"),
    ).toBe("allowBuilds:\n  sharp: true # generated\n");
  });

  it("preserves explicit denials, flow mappings, and unrelated configuration", () => {
    const denied =
      "packages:\n  - apps/*\nallowBuilds:\n  'sharp': false # user choice\n  esbuild: true\n";
    expect(mergePnpmSharpApproval(denied)).toBe(denied);
    const flow = "allowBuilds: { sharp: false, esbuild: true }\n";
    expect(mergePnpmSharpApproval(flow)).toBe(flow);
    const anchored = "allowBuilds: *sharedPolicy\n";
    expect(mergePnpmSharpApproval(anchored)).toBe(anchored);
    const unknown = "allowBuilds:\n  sharp: *nativePolicy\n";
    expect(mergePnpmSharpApproval(unknown)).toBe(unknown);
  });

  it("creates a local policy when none exists", () => {
    expect(mergePnpmSharpApproval("")).toBe("\nallowBuilds:\n  sharp: true\n");
  });
});
