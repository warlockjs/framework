import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatBytes, formatDistSummary, summarizeDist } from "./dist-summary";

const roots: string[] = [];

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("summarizeDist", () => {
  it("counts files recursively and adds up their sizes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "warlock-dist-summary-"));
    roots.push(root);
    mkdirSync(path.join(root, "client/assets"), { recursive: true });
    writeFileSync(path.join(root, "app.js"), "12345");
    writeFileSync(path.join(root, "client/assets/a.js"), "123");
    writeFileSync(path.join(root, "client/assets/a.css"), "12");

    expect(await summarizeDist(root)).toEqual({ files: 3, bytes: 10 });
  });

  it("reports an empty summary for a missing directory", async () => {
    expect(await summarizeDist("/nonexistent/warlock-dist")).toEqual({ files: 0, bytes: 0 });
  });
});

describe("formatDistSummary", () => {
  it("prints the count and size", () => {
    expect(formatDistSummary({ files: 1, bytes: 512 })).toBe("dist: 1 file, 512 B");
    expect(formatDistSummary({ files: 7, bytes: 2048 })).toBe("dist: 7 files, 2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});
