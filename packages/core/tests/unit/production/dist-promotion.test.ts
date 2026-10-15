import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDistReadyToStartAsync } from "../../../src/production/assert-dist-ready-to-start";
import {
  DIST_BUILD_MANIFEST_FILE_NAME,
  readDistBuildManifestAsync,
  writeDistBuildManifestAsync,
} from "../../../src/production/dist-build-manifest";
import {
  commitDistAsync,
  createTempOutputDir,
  rollbackDistAsync,
  stageDistAsync,
} from "../../../src/production/promote-dist";

/**
 * Real filesystem, no mocks — these are the exact primitives
 * `ProductionBuilder.build()` calls to leave `dist` reflecting only the
 * build that just ran (422a43c7) and to give `warlock start` an explicit
 * reason to refuse a `dist` that never finished a build (560cc1d1).
 */
describe("dist promotion", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "warlock-dist-promotion-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("createTempOutputDir", () => {
    it("returns a sibling of outDir, distinct from outDir and from itself on repeat calls", () => {
      const outDir = path.join(workDir, "dist");

      const first = createTempOutputDir(outDir);
      const second = createTempOutputDir(outDir);

      expect(path.dirname(first)).toBe(path.dirname(outDir));
      expect(first).not.toBe(outDir);
      expect(first).not.toBe(second);
    });
  });

  describe("stage + commit", () => {
    it("promotes with a single rename when outDir did not exist yet", async () => {
      const outDir = path.join(workDir, "dist");
      const tempDir = createTempOutputDir(outDir);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "app.js"), "console.log(1);");

      const staged = await stageDistAsync(tempDir, outDir);
      await commitDistAsync(staged);

      expect(staged.previousDir).toBeUndefined();
      expect(existsSync(path.join(outDir, "app.js"))).toBe(true);
      expect(existsSync(tempDir)).toBe(false);
    });

    it("replaces dist wholesale — a file that predates this build and is not one of its outputs is gone after promotion", async () => {
      const outDir = path.join(workDir, "dist");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "rem-stale-marker.txt"), "stale");

      const tempDir = createTempOutputDir(outDir);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "app.js"), "console.log(1);");

      const staged = await stageDistAsync(tempDir, outDir);
      await commitDistAsync(staged);

      expect(existsSync(path.join(outDir, "rem-stale-marker.txt"))).toBe(false);
      expect(existsSync(path.join(outDir, "app.js"))).toBe(true);
      expect(existsSync(tempDir)).toBe(false);

      // No leftover `.stale-*` staging directory beside `dist`.
      const siblingNames = readdirSync(workDir);
      expect(siblingNames.some((name) => name.includes(".stale-"))).toBe(false);
    });

    it("never leaves outDir missing when it previously existed", async () => {
      const outDir = path.join(workDir, "dist");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "app.js"), "console.log('old');");

      const tempDir = createTempOutputDir(outDir);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "app.js"), "console.log('new');");

      const staged = await stageDistAsync(tempDir, outDir);

      expect(existsSync(outDir)).toBe(true);

      await commitDistAsync(staged);

      expect(existsSync(outDir)).toBe(true);
    });

    it("exposes the real outDir to whatever runs between stage and commit, so files written then land in the promoted dist", async () => {
      const outDir = path.join(workDir, "dist");
      const tempDir = createTempOutputDir(outDir);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "app.js"), "console.log(1);");

      const staged = await stageDistAsync(tempDir, outDir);

      // Stands in for a connector `emit` hook: it is handed `outDir` — the
      // FINAL path, the one it also bakes into its manifest — and writes
      // there. The bug this replaces had it write into a temp directory the
      // promotion then renamed away.
      expect(staged.outDir).toBe(outDir);
      mkdirSync(path.join(staged.outDir, "client"), { recursive: true });
      writeFileSync(path.join(staged.outDir, "client", "index.js"), "// client");

      await commitDistAsync(staged);

      expect(existsSync(path.join(outDir, "app.js"))).toBe(true);
      expect(existsSync(path.join(outDir, "client", "index.js"))).toBe(true);
    });
  });

  describe("rollbackDistAsync", () => {
    it("restores the previous build and removes the half-finished one", async () => {
      const outDir = path.join(workDir, "dist");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "app.js"), "console.log('old');");
      writeFileSync(path.join(outDir, DIST_BUILD_MANIFEST_FILE_NAME), '{"status":"success"}');

      const tempDir = createTempOutputDir(outDir);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "app.js"), "console.log('new');");

      const staged = await stageDistAsync(tempDir, outDir);

      // A connector `emit` hook throws here, in the real build.
      await rollbackDistAsync(staged);

      expect(existsSync(outDir)).toBe(true);
      expect(readFileSync(path.join(outDir, "app.js"), "utf8")).toBe("console.log('old');");
      await expect(checkDistReadyToStartAsync(outDir)).resolves.toEqual({ ready: true });

      // Neither the parked previous build nor the discarded new one is left
      // sitting beside `dist`.
      const siblingNames = readdirSync(workDir);
      expect(siblingNames.some((name) => name.includes(".stale-"))).toBe(false);
      expect(siblingNames.some((name) => name.includes(".failed-"))).toBe(false);
    });

    it("leaves no dist at all when there was no previous build to restore", async () => {
      const outDir = path.join(workDir, "dist");
      const tempDir = createTempOutputDir(outDir);
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(path.join(tempDir, "app.js"), "console.log('new');");

      const staged = await stageDistAsync(tempDir, outDir);
      await rollbackDistAsync(staged);

      expect(existsSync(outDir)).toBe(false);
      await expect(checkDistReadyToStartAsync(outDir)).resolves.toMatchObject({ ready: false });
    });
  });

  describe("dist build manifest", () => {
    it("round-trips a success marker", async () => {
      const dir = path.join(workDir, "dist-a");
      mkdirSync(dir, { recursive: true });

      await writeDistBuildManifestAsync(dir);
      const manifest = await readDistBuildManifestAsync(dir);

      expect(manifest?.status).toBe("success");
      expect(typeof manifest?.builtAt).toBe("string");
      expect(existsSync(path.join(dir, DIST_BUILD_MANIFEST_FILE_NAME))).toBe(true);
    });

    it("returns undefined for a directory that was never built", async () => {
      const dir = path.join(workDir, "dist-b");
      mkdirSync(dir, { recursive: true });

      await expect(readDistBuildManifestAsync(dir)).resolves.toBeUndefined();
    });

    it("returns undefined when the marker exists but is not a success record", async () => {
      const dir = path.join(workDir, "dist-c");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, DIST_BUILD_MANIFEST_FILE_NAME),
        JSON.stringify({ status: "partial" }),
      );

      await expect(readDistBuildManifestAsync(dir)).resolves.toBeUndefined();
    });

    it("returns undefined when the marker is malformed JSON", async () => {
      const dir = path.join(workDir, "dist-d");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, DIST_BUILD_MANIFEST_FILE_NAME), "{not json");

      await expect(readDistBuildManifestAsync(dir)).resolves.toBeUndefined();
    });
  });

  describe("checkDistReadyToStartAsync — the reason `warlock start` refuses on", () => {
    it("is ready when dist carries a build-success marker", async () => {
      const dir = path.join(workDir, "dist-ready");
      mkdirSync(dir, { recursive: true });
      await writeDistBuildManifestAsync(dir);

      await expect(checkDistReadyToStartAsync(dir)).resolves.toEqual({ ready: true });
    });

    it("refuses and names the reason when dist has no build-success marker", async () => {
      const dir = path.join(workDir, "dist-not-ready");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "app.js"), "console.log(1);");

      const readiness = await checkDistReadyToStartAsync(dir);

      expect(readiness.ready).toBe(false);

      if (readiness.ready) {
        return;
      }

      expect(readiness.reason).toContain("warlock build");
      expect(readiness.reason).toContain(dir);
    });

    it("refuses when the dist directory does not exist at all", async () => {
      const dir = path.join(workDir, "does-not-exist");

      const readiness = await checkDistReadyToStartAsync(dir);

      expect(readiness.ready).toBe(false);
    });
  });
});
