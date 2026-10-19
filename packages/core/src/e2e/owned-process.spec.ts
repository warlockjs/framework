import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ rejectOn: 0, reads: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (file: string, encoding: "utf8") => {
      if (file.startsWith("/proc/") && file.endsWith("/cmdline")) {
        identity.reads++;
        if (identity.reads === identity.rejectOn) return "node\0/not-owned/other.mjs\0";
      }
      return actual.readFile(file, encoding);
    },
  };
});
import { OwnedProcess } from "./owned-process";
import type { ProcessEvidence } from "./types";

afterEach(() => {
  identity.rejectOn = 0;
  identity.reads = 0;
});
describe.skipIf(process.platform !== "linux")("PID-verified process groups", () => {
  for (const check of [1, 2]) {
    it(`refuses termination when identity check ${check} disagrees and permits verified recovery`, async () => {
      const root = await mkdtemp(join(tmpdir(), "warlock-owned-process-spec-"));
      const records: ProcessEvidence[] = [];
      const owned = await OwnedProcess.start(
        "fixture",
        [process.execPath, "-e", "setInterval(()=>{},1000)"],
        root,
        { PATH: process.env.PATH },
        root,
        records,
      );
      try {
        identity.rejectOn = check;
        await expect(owned.stop()).rejects.toThrow(
          "command line does not contain its recorded owner file",
        );
        expect(() => process.kill(owned.record.pid, 0)).not.toThrow();
        expect(owned.record.stopped).toBeUndefined();
        identity.rejectOn = 0;
        await owned.stop();
        expect(owned.record.stopped).toBe(true);
        expect(() => process.kill(owned.record.pid, 0)).toThrow();
      } finally {
        identity.rejectOn = 0;
        await owned.stop();
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
