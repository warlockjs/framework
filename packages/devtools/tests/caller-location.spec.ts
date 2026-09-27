import { describe, expect, it } from "vitest";

import { captureCallerLocation } from "../src/caller-location";

describe("captureCallerLocation", () => {
  it("uses the first application frame from a Windows stack", () => {
    expect(
      captureCallerLocation(
        "Error\n    at x (C:\\work\\node_modules\\lib\\index.js:1:2)\n    at app (C:\\work\\app\\source.ts:3:4)",
      ),
    ).toEqual({
      file: "C:/work/app/source.ts",
      line: 3,
      column: 4,
    });
  });

  it("skips Node's internal frames but keeps an app folder named internal", () => {
    expect(
      captureCallerLocation(
        "Error\n    at node:internal/process/task_queues:95:5\n    at run (C:\\work\\src\\app\\internal\\report.service.ts:12:3)",
      ),
    ).toEqual({
      file: "C:/work/src/app/internal/report.service.ts",
      line: 12,
      column: 3,
    });
  });

  it("decodes file URLs and skips node_modules frames", () => {
    expect(
      captureCallerLocation(
        "Error\n at file:///C:/work/node_modules/x.js:1:2\n at fn (file:///C:/work/my%20app/main.ts:7:8)",
      ),
    ).toEqual({
      file: "C:/work/my app/main.ts",
      line: 7,
      column: 8,
    });
  });
});
