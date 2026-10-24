import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpFamilyPins, bumpManifest, compareVersions, readMemberDirs } from "./set-version.mjs";

const manifest = (body) =>
  `{\r\n  "name": "@warlock.js/web",\r\n  "version": "5.29.0"${body ? `,\r\n${body}` : "\r\n"}}\r\n`;

test("moves the version and writes every family pin as a same-major range", () => {
  const input = manifest(
    [
      '  "peerDependencies": {',
      '    "@warlock.js/core": "5.29.0",',
      '    "@warlock.js/seal": "^5.29.0",',
      '    "@warlock.js/cache": "*",',
      '    "react": "5.29.0"',
      "  },",
      '  "devDependencies": {',
      '    "@warlock.js/logger": "workspace:^"',
      "  }",
      "",
    ].join("\r\n"),
  );

  const output = JSON.parse(bumpManifest(input, "5.29.0", "5.30.0"));

  assert.equal(output.version, "5.30.0");
  assert.equal(output.peerDependencies["@warlock.js/core"], "^5.30.0");
  assert.equal(output.peerDependencies["@warlock.js/seal"], "^5.30.0");
  assert.equal(output.peerDependencies["@warlock.js/cache"], "*");
  assert.equal(output.peerDependencies.react, "5.29.0", "a non-family package keeps its pin");
  assert.equal(output.devDependencies["@warlock.js/logger"], "workspace:^");
});

test("keeps the manifest's formatting and line endings", () => {
  const input = manifest("");
  const output = bumpManifest(input, "5.29.0", "5.30.0");

  assert.equal(output, input.replace('"version": "5.29.0"', '"version": "5.30.0"'));
  assert.match(output, /\r\n/);
});

test("refuses a manifest that is not at the family's current version", () => {
  assert.throws(
    () => bumpManifest(manifest(""), "5.28.0", "5.30.0"),
    /is at 5\.29\.0, expected 5\.28\.0/,
  );
});

test("moves real framework pins in a template and leaves the scaffolder placeholder", () => {
  const template = [
    "{",
    '  "version": "5.29.0",',
    '  "dependencies": {',
    '    "@warlock.js/core": "0.0.0-set-by-scaffolder",',
    '    "@warlock.js/web": "^5.29.0"',
    "  }",
    "}",
  ].join("\n");

  const output = JSON.parse(bumpFamilyPins(template, "5.29.0", "5.30.0"));

  assert.equal(output.version, "5.29.0", "a template app's own version is not the framework's");
  assert.equal(output.dependencies["@warlock.js/core"], "0.0.0-set-by-scaffolder");
  assert.equal(output.dependencies["@warlock.js/web"], "^5.30.0");
});

test("a template's exact pin stays exact: only package manifests get the range form", () => {
  const template = '{ "dependencies": { "@warlock.js/core": "5.29.0" } }';

  assert.equal(
    JSON.parse(bumpFamilyPins(template, "5.29.0", "5.30.0")).dependencies["@warlock.js/core"],
    "5.30.0",
  );
});

test("compares versions numerically, not as text", () => {
  assert.equal(compareVersions("5.10.0", "5.9.0"), 1);
  assert.equal(compareVersions("5.29.0", "5.29.0"), 0);
  assert.equal(compareVersions("5.29.0", "5.29.1"), -1);
});

test("reads member directories from the pkgist config", () => {
  const config =
    'a: { root: "../../packages/core" }, b: { root: "../../packages/ai-openai" }, c: { root: "../../packages/core" }';

  assert.deepEqual(readMemberDirs(config), ["packages/core", "packages/ai-openai"]);
});
