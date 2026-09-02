// @ts-check
// Red/green control for the docs changelog freshness gate. Run with
// `node --test scripts/check-changelog-freshness.test.mjs` (or
// `pnpm test:changelog-freshness`) from docs/. Importing this module — or
// check-changelog-freshness.mjs itself — must never hit the network or exit
// the process; see the direct-execution guard at the bottom of the script.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateFreshness,
  FreshnessDataError,
  FreshnessUnreachableError,
  getLocalNewestVersion,
  getRegistryNewestVersion,
  main,
  parseArgs,
  resolveChangelogPath,
} from "./check-changelog-freshness.mjs";

const ALLOW_UNREACHABLE_ENV = "WARLOCK_DOCS_ALLOW_REGISTRY_UNREACHABLE";

async function withChangelogFixture(releases, fn) {
  const dir = await mkdtemp(join(tmpdir(), "warlock-docs-changelog-"));
  const path = join(dir, "changelog.json");
  await writeFile(path, JSON.stringify({ releases }, null, 2), "utf8");
  try {
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function jsonResponse(status, body) {
  return {
    status,
    statusText: `status-${status}`,
    ok: status >= 200 && status < 300,
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

// --- parseArgs / resolveChangelogPath -------------------------------------

test("parseArgs reads --changelog <path>", () => {
  assert.deepEqual(parseArgs(["--changelog", "foo.json"]), { changelogPath: "foo.json" });
});

test("parseArgs reads --changelog=<path>", () => {
  assert.deepEqual(parseArgs(["--changelog=foo.json"]), { changelogPath: "foo.json" });
});

test("parseArgs returns null when --changelog is absent", () => {
  assert.deepEqual(parseArgs([]), { changelogPath: null });
  assert.deepEqual(parseArgs(["--other", "x"]), { changelogPath: null });
});

test("resolveChangelogPath defaults to src/data/changelog.json", () => {
  const resolved = resolveChangelogPath(null);
  assert.ok(resolved.endsWith(join("src", "data", "changelog.json")));
});

test("resolveChangelogPath resolves an explicit path against the CWD", () => {
  const resolved = resolveChangelogPath("some/fixture.json");
  assert.ok(resolved.endsWith(join("some", "fixture.json")));
  assert.ok(resolved.startsWith(process.cwd()));
});

// --- getLocalNewestVersion --------------------------------------------------

test("getLocalNewestVersion picks the highest published release, ignoring Unreleased", async () => {
  await withChangelogFixture(
    [{ version: "Unreleased" }, { version: "5.2.3" }, { version: "5.2.4" }, { version: "5.1.0" }],
    async (path) => {
      assert.equal(await getLocalNewestVersion(path), "5.2.4");
    },
  );
});

test("getLocalNewestVersion rejects a missing releases array as a data error", async () => {
  await withChangelogFixture(undefined, async (path) => {
    await writeFile(path, JSON.stringify({ notReleases: [] }), "utf8");
    await assert.rejects(getLocalNewestVersion(path), FreshnessDataError);
  });
});

test("getLocalNewestVersion rejects malformed JSON as a data error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "warlock-docs-changelog-"));
  const path = join(dir, "changelog.json");
  await writeFile(path, "{ not json", "utf8");
  try {
    await assert.rejects(getLocalNewestVersion(path), FreshnessDataError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getLocalNewestVersion rejects an invalid SemVer release version as a data error", async () => {
  await withChangelogFixture([{ version: "not-a-version" }], async (path) => {
    await assert.rejects(getLocalNewestVersion(path), FreshnessDataError);
  });
});

test("getLocalNewestVersion rejects a release entry missing a string version as a data error, even alongside a valid one", async () => {
  await withChangelogFixture([{ version: "5.2.4" }, { notVersion: "oops" }], async (path) => {
    await assert.rejects(getLocalNewestVersion(path), FreshnessDataError);
  });
});

test("getLocalNewestVersion rejects a release entry with a non-string version as a data error", async () => {
  await withChangelogFixture([{ version: 5.24 }], async (path) => {
    await assert.rejects(getLocalNewestVersion(path), FreshnessDataError);
  });
});

test("getLocalNewestVersion still ignores an explicit Unreleased version", async () => {
  await withChangelogFixture([{ version: "Unreleased" }, { version: "5.2.4" }], async (path) => {
    assert.equal(await getLocalNewestVersion(path), "5.2.4");
  });
});

test("getLocalNewestVersion rejects a missing file as a data error", async () => {
  await assert.rejects(
    getLocalNewestVersion(join(tmpdir(), "definitely-does-not-exist-changelog.json")),
    FreshnessDataError,
  );
});

// --- getRegistryNewestVersion ----------------------------------------------

test("getRegistryNewestVersion picks the highest valid version, prereleases included", async () => {
  const versions = {
    "5.2.3": {},
    "5.2.4": {},
    "5.3.0-rc.1": {},
  };
  const fetchImpl = async () => jsonResponse(200, { versions });
  assert.equal(await getRegistryNewestVersion(fetchImpl), "5.3.0-rc.1");
});

test("getRegistryNewestVersion prefers a release over its own prerelease", async () => {
  const versions = { "5.2.4": {}, "5.2.4-rc.1": {} };
  const fetchImpl = async () => jsonResponse(200, { versions });
  assert.equal(await getRegistryNewestVersion(fetchImpl), "5.2.4");
});

test("getRegistryNewestVersion throws FreshnessDataError on any malformed versions key, even alongside a valid one", async () => {
  const versions = { "5.2.4": {}, "not-semver": {} };
  const fetchImpl = async () => jsonResponse(200, { versions });
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessDataError);
});

test("getRegistryNewestVersion throws FreshnessUnreachableError on network failure", async () => {
  const fetchImpl = async () => {
    throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
  };
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessUnreachableError);
});

test("getRegistryNewestVersion throws FreshnessUnreachableError on 429", async () => {
  const fetchImpl = async () => jsonResponse(429, {});
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessUnreachableError);
});

test("getRegistryNewestVersion throws FreshnessUnreachableError on 503", async () => {
  const fetchImpl = async () => jsonResponse(503, {});
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessUnreachableError);
});

test("getRegistryNewestVersion throws FreshnessDataError on 404", async () => {
  const fetchImpl = async () => jsonResponse(404, {});
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessDataError);
});

test("getRegistryNewestVersion throws FreshnessDataError on malformed JSON body", async () => {
  const fetchImpl = async () => jsonResponse(200, new Error("unexpected token"));
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessDataError);
});

test("getRegistryNewestVersion throws FreshnessDataError when versions is missing", async () => {
  const fetchImpl = async () => jsonResponse(200, {});
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessDataError);
});

test("getRegistryNewestVersion throws FreshnessDataError when no version key is valid SemVer", async () => {
  const fetchImpl = async () => jsonResponse(200, { versions: { latest: {}, foo: {} } });
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessDataError);
});

test("getRegistryNewestVersion requests a bounded, non-redirecting, non-cached fetch", async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse(200, { versions: { "5.2.4": {} } });
  };
  await getRegistryNewestVersion(fetchImpl);
  assert.equal(capturedUrl, "https://registry.npmjs.org/@warlock.js%2Fcore");
  assert.equal(capturedOptions.cache, "no-store");
  assert.equal(capturedOptions.redirect, "manual");
  assert.ok(capturedOptions.signal instanceof AbortSignal);
  assert.equal(capturedOptions.headers["Cache-Control"], "no-cache");
});

test("getRegistryNewestVersion treats an opaque (manual) redirect response as a data error", async () => {
  const fetchImpl = async () => ({
    status: 0,
    statusText: "",
    ok: false,
    async json() {
      throw new Error("opaqueredirect responses have no body");
    },
  });
  await assert.rejects(getRegistryNewestVersion(fetchImpl), FreshnessDataError);
});

// --- evaluateFreshness -------------------------------------------------------

test("evaluateFreshness is current when local equals registry", () => {
  assert.equal(evaluateFreshness("5.2.4", "5.2.4").status, "current");
});

test("evaluateFreshness is current when local is ahead of registry", () => {
  assert.equal(evaluateFreshness("5.3.0", "5.2.4").status, "current");
});

test("evaluateFreshness is stale when local is behind and names both versions", () => {
  const result = evaluateFreshness("5.2.3", "5.2.4");
  assert.equal(result.status, "stale");
  assert.match(result.message, /5\.2\.3/);
  assert.match(result.message, /5\.2\.4/);
  assert.match(result.message, /cannot be bypassed/);
});

// --- main() end-to-end -------------------------------------------------------

test("main() passes when local is current with the registry", async () => {
  await withChangelogFixture([{ version: "5.2.4" }, { version: "5.2.3" }], async (path) => {
    const fetchImpl = async () => jsonResponse(200, { versions: { "5.2.3": {}, "5.2.4": {} } });
    const result = await main(["--changelog", path], { fetchImpl });
    assert.equal(result.status, "current");
  });
});

test("main() throws naming both versions when local is stale", async () => {
  await withChangelogFixture([{ version: "5.2.3" }], async (path) => {
    const fetchImpl = async () => jsonResponse(200, { versions: { "5.2.3": {}, "5.2.4": {} } });
    await assert.rejects(main(["--changelog", path], { fetchImpl }), (err) => {
      assert.match(err.message, /5\.2\.3/);
      assert.match(err.message, /5\.2\.4/);
      return true;
    });
  });
});

test("main() throws on registry unreachability by default, naming the escape env var", async () => {
  await withChangelogFixture([{ version: "5.2.4" }], async (path) => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    delete process.env[ALLOW_UNREACHABLE_ENV];
    await assert.rejects(main(["--changelog", path], { fetchImpl }), (err) => {
      assert.match(err.message, new RegExp(ALLOW_UNREACHABLE_ENV));
      return true;
    });
  });
});

test("main() only warns and passes on unreachability when the escape env var is exactly '1'", async () => {
  await withChangelogFixture([{ version: "5.2.4" }], async (path) => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    process.env[ALLOW_UNREACHABLE_ENV] = "1";
    try {
      const result = await main(["--changelog", path], { fetchImpl });
      assert.equal(result.status, "unreachable-allowed");
      assert.match(result.message, /cannot bypass a measured stale version/);
    } finally {
      delete process.env[ALLOW_UNREACHABLE_ENV];
    }
  });
});

test("main() does not honor the escape env var for a truthy-but-not-'1' value", async () => {
  await withChangelogFixture([{ version: "5.2.4" }], async (path) => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    process.env[ALLOW_UNREACHABLE_ENV] = "true";
    try {
      await assert.rejects(main(["--changelog", path], { fetchImpl }));
    } finally {
      delete process.env[ALLOW_UNREACHABLE_ENV];
    }
  });
});

test("main() never honors the escape env var for invalid/malformed registry data", async () => {
  await withChangelogFixture([{ version: "5.2.4" }], async (path) => {
    const fetchImpl = async () => jsonResponse(200, {});
    process.env[ALLOW_UNREACHABLE_ENV] = "1";
    try {
      await assert.rejects(main(["--changelog", path], { fetchImpl }), FreshnessDataError);
    } finally {
      delete process.env[ALLOW_UNREACHABLE_ENV];
    }
  });
});

test("main() never honors the escape env var to bypass a measured stale version", async () => {
  await withChangelogFixture([{ version: "5.2.3" }], async (path) => {
    const fetchImpl = async () => jsonResponse(200, { versions: { "5.2.3": {}, "5.2.4": {} } });
    process.env[ALLOW_UNREACHABLE_ENV] = "1";
    try {
      await assert.rejects(main(["--changelog", path], { fetchImpl }), (err) => {
        assert.match(err.message, /5\.2\.3/);
        assert.match(err.message, /5\.2\.4/);
        return true;
      });
    } finally {
      delete process.env[ALLOW_UNREACHABLE_ENV];
    }
  });
});
