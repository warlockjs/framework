import esbuild from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reactProductionEnv } from "./react-production-env";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-react-env-"));
  const react = path.join(root, "node_modules/react");
  const other = path.join(root, "node_modules/other");

  mkdirSync(react, { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(path.join(react, "package.json"), '{"name":"react","main":"index.js"}');
  writeFileSync(
    path.join(react, "index.js"),
    "module.exports = process.env.NODE_ENV === 'production' ? 'PROD_BUILD' : 'DEV_BUILD';\n",
  );
  writeFileSync(path.join(other, "package.json"), '{"name":"other","main":"index.js"}');
  writeFileSync(path.join(other, "index.js"), "module.exports = process.env.NODE_ENV;\n");
  writeFileSync(
    path.join(root, "entry.js"),
    'import react from "react"; import other from "other"; console.log(react, other);\n',
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("reactProductionEnv", () => {
  it("settles NODE_ENV in React's files only", async () => {
    const result = await esbuild.build({
      entryPoints: [path.join(root, "entry.js")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      logLevel: "silent",
      outfile: path.join(root, "out.js"),
      plugins: [reactProductionEnv()],
    });
    const text = result.outputFiles[0]!.text;

    expect(text).toContain('true ? "PROD_BUILD" : "DEV_BUILD"');
    expect(text).toContain("process.env.NODE_ENV");
    expect(text.match(/process\.env\.NODE_ENV/g)).toHaveLength(1);
  });
});
