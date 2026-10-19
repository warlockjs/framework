import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defineE2E, E2ERunError, findBrowserBinary, runE2E } from "../../../src/e2e";
import type { E2EEvidence } from "../../../src/e2e";

const binary = await findBrowserBinary();
const test = it.skipIf(!binary);
const missing = binary ? "" : " [skipped: no Chrome/Edge binary found; set WARLOCK_E2E_BROWSER]";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const source = await mkdtemp(join(tmpdir(), "warlock-real-browser-spec-"));
  roots.push(source);
  await writeFile(
    join(source, "server.mjs"),
    `
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
const normal=\`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}input,button{display:block;max-width:90%}#cover{position:fixed;inset:0;background:white;z-index:10}</style><div id="cover"></div><input id="name" value="old"><button id="save"><span>Save</span></button><h1 id="result">Ready</h1><script>setTimeout(()=>document.querySelector('#cover').remove(),200);document.querySelector('#save').onclick=()=>{history.pushState({},'', '/done');document.querySelector('#result').textContent=document.querySelector('#name').value;fetch('/api/ready')};</script>\`;
const app=createServer((req,res)=>{
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return}
 if(req.url==='/missing'){res.writeHead(404);res.end('missing');return}
 if(req.url==='/api/ready'){setTimeout(()=>res.end('ready'),200);return}
 res.setHeader('Content-Type','text/html');
 if(req.url==='/wide')res.end(normal+'<div id="wide" style="width:448px">wide content</div>');
 else if(req.url==='/errors')res.end(normal+'<script>console.error("deliberate console failure");fetch("/missing")</script>');
 else res.end(normal);
});
app.listen(0,'127.0.0.1',()=>writeFileSync(process.env.WARLOCK_E2E_PORT_FILE,String(app.address().port)));
`,
  );
  return { source, outputDirectory: join(source, "results") };
}
// Chromium's root-container override is explicit, never a harness default.
// https://chromium.googlesource.com/chromium/src/+/main/sandbox/policy/switches.cc
const browser = { binary, args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] };

test(
  "runs a real owned browser flow, captures both widths and verifies cleanup" + missing,
  async () => {
    const { source, outputDirectory } = await fixture();
    let ownedRoot = "";
    const result = await runE2E(
      defineE2E({
        app: { directory: source, start: [process.execPath, "server.mjs"], portFromFile: true },
        browser,
        run: async ({ page, dataRoot, step }) => {
          ownedRoot = dataRoot;
          await step("save a name", async () => {
            await page.goto("/");
            await page.fill("#name", "Ada");
            await page.type("#name", " Lovelace");
            await page.waitForNavigation(() => page.click("#save"), { url: "/done" });
            await page.waitFor({ selector: "#result", text: "Ada Lovelace" });
          });
          await page.captureViewports("saved");
        },
      }),
      { outputDirectory },
    );
    expect(result.evidence.status).toBe("passed");
    expect(result.evidence.console.filter(({ level }) => level === "error")).toEqual([]);
    expect(result.evidence.networkFailures).toEqual([]);
    expect(result.evidence.screenshots.map(({ viewport }) => viewport.width)).toEqual([
      1280, 390, 1280, 390,
    ]);
    expect(result.evidence.processes.every(({ stopped }) => stopped)).toBe(true);
    for (const screenshot of result.evidence.screenshots) {
      const png = await readFile(join(result.outputDirectory, screenshot.file));
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    const persisted = JSON.parse(await readFile(result.evidenceFile, "utf8")) as E2EEvidence;
    expect(persisted.steps.some(({ name }) => name === "save a name")).toBe(true);
    await expect(access(ownedRoot)).rejects.toThrow();
  },
  60_000,
);

test(
  "fails expanded phone layouts with screenshots and widest-element evidence" + missing,
  async () => {
    const { source, outputDirectory } = await fixture();
    const failure = await runE2E(
      {
        app: { directory: source, start: [process.execPath, "server.mjs"], portFromFile: true },
        browser,
        run: async ({ page }) => {
          await page.goto("/wide");
        },
      },
      { outputDirectory },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(E2ERunError);
    if (!(failure instanceof E2ERunError)) throw new Error("Expected browser harness failure");
    expect(failure.result.evidence.errors.join("\n")).toMatch(/phone.*448/);
    expect(failure.result.evidence.errors.join("\n")).toContain('"id":"wide"');
    expect(failure.result.evidence.screenshots).toHaveLength(2);
    expect(failure.result.evidence.processes.every(({ stopped }) => stopped)).toBe(true);
  },
  60_000,
);

test(
  "fails console and HTTP errors while publishing evidence and stopping its PIDs" + missing,
  async () => {
    const { source, outputDirectory } = await fixture();
    const failure = await runE2E(
      {
        app: { directory: source, start: [process.execPath, "server.mjs"], portFromFile: true },
        browser,
        run: async ({ page }) => {
          await page.goto("/errors");
        },
      },
      { outputDirectory },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(E2ERunError);
    if (!(failure instanceof E2ERunError)) throw new Error("Expected browser harness failure");
    expect(
      failure.result.evidence.console.some(({ text }) =>
        text.includes("deliberate console failure"),
      ),
    ).toBe(true);
    expect(failure.result.evidence.networkFailures.some(({ status }) => status === 404)).toBe(true);
    expect(failure.result.evidence.status).toBe("failed");
    expect(failure.result.evidence.processes.every(({ stopped }) => stopped)).toBe(true);
    expect(JSON.parse(await readFile(failure.result.evidenceFile, "utf8"))).toMatchObject({
      status: "failed",
    });
  },
  60_000,
);
