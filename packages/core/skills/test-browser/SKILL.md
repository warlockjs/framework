---
name: test-browser
description: Write or repair browser e2e specs using warlock e2e and @warlock.js/core/e2e, with owned app fixtures, direct CDP interaction, responsive screenshots and run evidence. Use for real browser flows, click races or viewport overflow; use test-http for API-only tests.
---

# Browser e2e

Use `@warlock.js/core/e2e`, a Node-only subpath, and default-export `defineE2E` from
`e2e/*.e2e.ts`. Run `npx warlock e2e`. The CLI loads TypeScript itself; no Vitest
bootstrap, Playwright, Puppeteer or external browser server is needed.

Every run copies the app into a temporary directory, excludes dotenv files and
symlinks, links installed dependencies for reads, seeds its own environment and
owns the app/browser process groups. Keep foreground commands in the fixture;
never use a shared dev server or daemonize. Map the disposable `dataRoot` into the
app's actual storage/database config. The harness cannot infer that mapping.
`prepare` is where seeds and fake executables belong; `app.path` is relative to the
copied app. Do not install dependencies through the shared `node_modules` link.

## Complete standalone spec

This spec creates its own small app; it can be pasted into an existing project
with core installed and run with `npx warlock e2e`.

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineE2E } from "@warlock.js/core/e2e";

export default defineE2E({
  app: {
    start: [process.execPath, "form-fixture.mjs"],
    portFromFile: true,
    path: ["fake-bin"],
    env: ({ dataRoot }) => ({ FORM_DATA: dataRoot }),
    prepare: async ({ directory, dataRoot }) => {
      await mkdir(join(directory, "fake-bin"));
      await writeFile(join(dataRoot, "prefix.txt"), "Saved");
      await writeFile(
        join(directory, "form-fixture.mjs"),
        `
        import { createServer } from 'node:http';
        import { readFileSync, writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        const prefix = readFileSync(join(process.env.FORM_DATA, 'prefix.txt'), 'utf8');
        const server = createServer((request, response) => {
          if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<input id="name"><button id="save"><span>Save</span></button><h1 id="result">Ready</h1>'
            + '<script>document.querySelector("#save").onclick=()=>{history.pushState({},"","/saved");document.querySelector("#result").textContent='
            + JSON.stringify(prefix) + '+" "+document.querySelector("#name").value}</script>');
        });
        server.listen(0, '127.0.0.1', () => writeFileSync(process.env.WARLOCK_E2E_PORT_FILE, String(server.address().port)));
      `,
      );
    },
  },
  run: async ({ page, step }) => {
    await page.goto("/");
    await step("save the form", async () => {
      await page.fill("#name", "Ada");
      await page.type("#name", " Lovelace");
      await page.waitForNavigation(() => page.click("#save"), { url: "/saved" });
      await page.waitFor({ selector: "#result", text: "Saved Ada Lovelace" });
    });
    await page.captureViewports("saved");
  },
});
```

For an existing app, replace `prepare` and `start`; default start is
`[process.execPath, "dist/app.js"]`. Optional
`build: [process.execPath, "node_modules/@warlock.js/core/bin/warlock.js", "build"]`
builds inside the copy. Supply app-specific test service variables via `env` and
exclude production data directories with `exclude: ["storage", "data"]`.
By default the fixture supplies an OS-assigned `PORT`/`HTTP_PORT`. Prefer the
port-file handshake above when the app supports binding `0` itself.

## Interaction and evidence

- Use `page.click` for scrolling, settled boxes and hit testing, including a fresh
  check after hover. Do not replace it with `element.click()` or fixed sleeps.
- `fill` clears editable content, then sends CDP text input; `type` appends Unicode
  text. Values do not appear in step names. `type` does not simulate shortcuts.
- `waitFor({ selector, text, url, timeoutMs })` combines conditions. Arm navigation
  **before** clicking with `waitForNavigation(() => page.click(...))`.
- `setViewport({ name, width, height, mobile })`, `assertViewport()` and
  `screenshot(name)` are available independently. `captureViewports(name)` checks
  and captures 1280×800 desktop and 390×844 phone by default, restoring the
  original viewport. `viewports` overrides the list. Final captures are automatic.
- Overflow compares document/body scrollWidth **and innerWidth** against the
  requested width, so a phone that expands to 448 px fails. Keep the viewport meta
  tag; inspect the reported widest element IDs, classes and dimensions.
- Health requires zero console errors, exceptions, HTTP statuses >=400 and failed
  loads (including cancellation). Narrow exceptions use
  `allowConsoleErrors: [/^Expected warning$/]` and
  `allowNetworkFailures: [{ url: "/missing", status: 404 }]`. Canceled-request rules
  can match `errorText`. Strings match substrings; regexps are also accepted.
- `allowPendingRequests: ["/events"]` exempts an intentional stream from network
  idle, without allowing its errors. `waitForNetworkIdle()` remains available.
- `page.evaluate<T>(expression)` is an escape hatch for assertions in the main
  document. Selector helpers do not enter frames or closed shadow roots.

Use `--browser /path/to/chrome` or `WARLOCK_E2E_BROWSER` if discovery fails.
Set `browser.startupTimeoutMs` (default 30 seconds) when the browser is slow to start, for example on shared CI runners.
`browser: { args: ["--no-sandbox"] }` is an explicit option for controlled root
containers; it is not a default. On Windows, command arrays should invoke JS tools
through `process.execPath`, avoiding `.cmd` executables that require a shell.

Read `.warlock/e2e/run-*/evidence.json` and the PNGs/logs on failure. Evidence keeps
allowed errors, step timings, viewport dimensions and recorded process identities.
`--out` changes the evidence parent; `--path ./fake-bin,./engine-bin` prepends fake
binary paths. `runE2E(spec, { outputDirectory, browser, path, signal })` is the
programmatic runner; `E2ERunError.result` exposes evidence on failure.

Cleanup verifies the unique supervisor command line before stopping only its
recorded process group (Windows: verified PID tree). It retains disposable files
if ownership verification fails and reports the failure in evidence. Do not add
process-name or port-based kills to a spec.

## Accessibility checks

Call `await page.assertAccessible()` after the content is visible and again after
opening menus, dialogs or validation feedback. The harness reads its pinned local
axe-core distribution and injects it with CDP `Runtime.evaluate`; it never fetches
a CDN script or adds axe to the app bundle. A missing dependency, injection error,
unmatched selector or scan exception fails the step.

```ts
await page.assertAccessible();
await page.assertAccessible({
  selector: "main",
  tags: ["wcag2a", "wcag2aa", "wcag21aa"],
  allow: [{ id: "color-contrast", selector: ".legacy-caption" }],
  timeoutMs: 30_000,
});
```

Defaults run all enabled axe rules on the document. `tags` uses axe's `runOnly`
tag filter; `selector` limits the scanned region. Allowances match exact rule IDs
and, when supplied, an exact single-element target selector. Omitting `selector`
from an allowance permits that rule everywhere; keep exceptions narrow. Nested
frame/shadow targets cannot match a simple selector allowance. Allowed nodes stay
in evidence with `allowed: true`; other nodes of the same rule still fail.

Evidence's `accessibility` array contains URL, viewport, timestamp, violations
with rule IDs and target selectors, and incomplete checks for manual review.
Incomplete checks do not fail automatically. A passing automated scan does not
replace keyboard, screen-reader, focus-order or contrast review. See the
[axe API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md) for scan
semantics. Run at both 390 and 1280 pixels with `assertViewport()` as well.

## Watched development checks

Use an owned app copy with `app.env: { NODE_ENV: "development" }` and
`app.start: [process.execPath, "node_modules/@warlock.js/core/bin/warlock.js", "dev"]`.
Do not attach to an existing server. The fixture's `directory` is available in
`run`; use `node:fs/promises` to edit only files inside that copy.

Wait for a visible revision marker after each edit; a successful file write alone
does not prove watcher invalidation or browser hydration. Exercise several edits,
including setup-file creation, changes and removal. After each revision, request
the page again, exercise a hydrated control, check imported `shared` in loaders
and middleware, and verify concurrent requests keep distinct values. Do not
allowlist request-store or hydration errors to make these checks pass.

For forms beneath layouts, compare server-rendered IDs with the hydrated hook
values (for example expose the hook value in a click handler), check repeated
instances, label `for` and ARIA references, then navigate away and back. Comparing
DOM IDs alone can miss a mismatch: React may retain the server attribute while
client handlers capture another ID. Capture evidence and screenshots at every
revision. Do not replace React's `useId()` globally or hide hydration warnings.
