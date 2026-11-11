import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

const { renderCalls, gzipSyncCalls } = vi.hoisted(() => ({
  renderCalls: { count: 0 },
  gzipSyncCalls: { count: 0 },
}));

vi.mock("../src/xml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/xml")>();

  return {
    ...actual,
    renderUrlBlock: (...args: Parameters<typeof actual.renderUrlBlock>) => {
      renderCalls.count++;
      return actual.renderUrlBlock(...args);
    },
  };
});

vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();

  return {
    ...actual,
    gzipSync: (...args: Parameters<typeof actual.gzipSync>) => {
      gzipSyncCalls.count++;
      return actual.gzipSync(...args);
    },
  };
});

import { DuplicatePathTracker } from "../src/duplicate-path-tracker";
import { normalizeEntry } from "../src/normalize-entry";
import { RouteCounter } from "../src/route-counter";
import { Sitemap } from "../src/sitemap";
import { writeShardGroup } from "../src/sitemap-shard-writer";
import { buildSitemapXml, escapeXml } from "../src/xml";

const baseUrl = "https://example.com";
/** Characters XML 1.0 forbids in a document. */
// oxlint-disable-next-line eslint/no-control-regex -- matching control characters is the point.
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

let workDir: string | undefined;

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = undefined;
});

describe("sitemap <loc> encoding", () => {
  it("percent-encodes a control character so the file stays well-formed XML", () => {
    const xml = new Sitemap({ baseUrl }).add({ path: "/posts/a\u0001b" }).toXML();

    expect(xml).toContain("<loc>https://example.com/posts/a%01b</loc>");
    expect(XML_ILLEGAL.test(xml)).toBe(false);
  });

  it("percent-encodes spaces and non-ASCII text as UTF-8", () => {
    expect(normalizeEntry({ path: "/posts/café au lait" }, {}).path).toBe(
      "/posts/caf%C3%A9%20au%20lait",
    );
  });

  it("leaves an already-encoded path and a query string unchanged", () => {
    expect(normalizeEntry({ path: "/posts/caf%C3%A9?page=2&sort=new" }, {}).path).toBe(
      "/posts/caf%C3%A9?page=2&sort=new",
    );
  });

  it("encodes a stray percent sign and replaces a lone surrogate", () => {
    expect(normalizeEntry({ path: "/100%" }, {}).path).toBe("/100%25");
    expect(normalizeEntry({ path: "/a\uD800b" }, {}).path).toBe("/a%EF%BF%BDb");
  });

  it("drops XML-illegal characters from escaped text", () => {
    expect(escapeXml("en\u0000\u000B-US & co")).toBe("en-US &amp; co");
  });
});

describe("sitemap shard writer", () => {
  const entries = [
    { path: "/a", lastmod: "2026-01-01" },
    { path: "/b", alternates: [{ hreflang: "ar", path: "/ar/b" }] },
    { path: "/c", priority: 0.5 },
  ];

  function context(gzip: boolean, dir: string) {
    return {
      tempDir: dir,
      baseUrl,
      filePrefix: "sitemap",
      gzip,
      maxUrlsPerFile: 50_000,
      maxBytesPerFile: 50 * 1024 * 1024,
      defaults: {},
      duplicates: new DuplicatePathTracker(),
      routes: new RouteCounter(),
    };
  }

  it("renders each entry once and writes the same XML as before", async () => {
    workDir = await mkdtemp(join(tmpdir(), "sitemap-hardening-"));
    renderCalls.count = 0;

    const [shard] = await writeShardGroup({ factories: [() => entries] }, context(false, workDir));
    const written = await readFile(join(workDir, shard!.fileName), "utf8");

    expect(renderCalls.count).toBe(entries.length);
    expect(written).toBe(
      buildSitemapXml(
        entries.map((entry) => normalizeEntry(entry, {})),
        baseUrl,
      ),
    );
  });

  it("compresses shards without blocking the event loop", async () => {
    workDir = await mkdtemp(join(tmpdir(), "sitemap-hardening-"));
    gzipSyncCalls.count = 0;

    const [shard] = await writeShardGroup({ factories: [() => entries] }, context(true, workDir));
    const written = gunzipSync(await readFile(join(workDir, shard!.fileName))).toString("utf8");

    expect(gzipSyncCalls.count).toBe(0);
    expect(written).toContain("<loc>https://example.com/b</loc>");
  });
});
