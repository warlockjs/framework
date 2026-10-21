import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { CdpConnection } from "./cdp";
import { fakeCdp, type FakeCommand } from "./fake-cdp.test-support";
import { boxesStable, BrowserPage } from "./page";
import type { E2EEvidence, E2ESpec } from "./types";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
export function makeEvidence(): E2EEvidence {
  return {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: "running",
    steps: [],
    console: [],
    networkFailures: [],
    screenshots: [],
    processes: [],
    errors: [],
  };
}
async function setup(
  evaluate: (expression: string) => unknown = () => true,
  extra: Partial<E2ESpec> = {},
) {
  const endpoint = await fakeCdp((command: FakeCommand) => {
    if (command.method === "Runtime.evaluate")
      return { result: { result: { value: evaluate(String(command.params.expression)) } } };
    if (command.method === "Page.captureScreenshot")
      return { result: { data: Buffer.from("fake png").toString("base64") } };
    return { result: {} };
  });
  cleanups.push(endpoint.close);
  const cdp = await CdpConnection.connect(endpoint.url);
  cleanups.push(() => cdp.close());
  const directory = await mkdtemp(join(tmpdir(), "warlock-page-spec-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const evidence = makeEvidence();
  const page = new BrowserPage(cdp, "http://127.0.0.1:12345", directory, evidence, {
    app: {},
    run: async () => {},
    ...extra,
  });
  return { page, endpoint, evidence, directory };
}
const stable = { x: 50, y: 60, width: 100, height: 20, reason: "" };

describe("browser page over a fake CDP endpoint", () => {
  it("waits for an uncovered, stationary box and rechecks after hover", async () => {
    let probe = 0;
    const { page, endpoint, evidence } = await setup(() => {
      probe++;
      if (probe === 1) return { ...stable, reason: "target is covered by DIALOG" };
      if (probe === 2) return { ...stable, width: 80 };
      if (probe === 5) return { ...stable, reason: "hover overlay" };
      return stable;
    });
    await page.click("#save", 2000);
    const mouse = endpoint.commands.filter(({ method }) => method === "Input.dispatchMouseEvent");
    expect(mouse.map(({ params }) => params.type)).toEqual([
      "mouseMoved",
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ]);
    expect(probe).toBeGreaterThanOrEqual(8);
    expect(mouse.at(-2)?.params).toMatchObject({ x: 50, y: 60, buttons: 1, clickCount: 1 });
    expect(evidence.steps[0]).toMatchObject({ name: "click #save", status: "passed" });
  });

  it("fails a covered click with a clear reason and never presses the mouse", async () => {
    const { page, endpoint, evidence } = await setup(() => ({
      ...stable,
      reason: "target is covered by DIALOG#modal",
    }));
    await expect(page.click("#save", 100)).rejects.toThrow("target is covered by DIALOG#modal");
    expect(endpoint.commands.some(({ method }) => method === "Input.dispatchMouseEvent")).toBe(
      false,
    );
    expect(evidence.steps[0].status).toBe("failed");
  });

  it("keeps the covered reason when a later probe runs out of the deadline", async () => {
    let probes = 0;
    const endpoint = await fakeCdp((command: FakeCommand) => {
      if (command.method !== "Runtime.evaluate") return { result: {} };
      probes++;
      // The first probe answers with the covered target. Later probes get no reply,
      // so each fails with a CDP timeout once the shrinking deadline runs out.
      if (probes === 1)
        return {
          result: { result: { value: { ...stable, reason: "target is covered by DIALOG#modal" } } },
        };
      return undefined;
    });
    cleanups.push(endpoint.close);
    const cdp = await CdpConnection.connect(endpoint.url);
    cleanups.push(() => cdp.close());
    const directory = await mkdtemp(join(tmpdir(), "warlock-page-spec-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const page = new BrowserPage(cdp, "http://127.0.0.1:12345", directory, makeEvidence(), {
      app: {},
      run: async () => {},
    });
    await expect(page.click("#save", 100)).rejects.toThrow(
      /^Cannot click "#save" within 100ms: target is covered by DIALOG#modal$/,
    );
    expect(probes).toBeGreaterThan(1);
    expect(endpoint.commands.some(({ method }) => method === "Input.dispatchMouseEvent")).toBe(
      false,
    );
  });

  it("compares dimensions as well as centers for layout stability", () => {
    expect(boxesStable(stable, { ...stable, width: 101 })).toBe(false);
    expect(boxesStable(stable, { ...stable, x: 50.1 })).toBe(true);
    expect(boxesStable(stable, { ...stable, reason: "hidden" })).toBe(false);
  });

  it("clears with native setters, then fills and types Unicode using CDP text input", async () => {
    const { page, endpoint } = await setup((expression) =>
      expression.includes("scrollIntoView") ? stable : true,
    );
    await page.fill("#name", "Ada");
    await page.type("#name", " مرحبا");
    expect(
      endpoint.commands
        .filter(({ method }) => method === "Input.insertText")
        .map(({ params }) => params.text),
    ).toEqual(["Ada", " مرحبا"]);
    expect(
      endpoint.commands.some(({ params }) =>
        String(params.expression).includes("setter.call(element,''"),
      ),
    ).toBe(true);
  });

  it("waits for selector/text/URL conditions and records timeout failures", async () => {
    let polls = 0;
    const { page } = await setup(() => ++polls > 1);
    await page.waitFor({ selector: "h1", text: "Ready", url: "/ready", timeoutMs: 300 });
    await expect(page.waitFor({})).rejects.toThrow("selector, text, or URL");
    const never = await setup(() => false);
    await expect(never.page.waitFor({ text: "missing", timeoutMs: 60 })).rejects.toThrow("waitFor");
  });

  it("arms navigation before invoking the action, including reloads", async () => {
    const before = { href: "http://127.0.0.1:12345/", timeOrigin: 1 };
    const { page, endpoint } = await setup((expression) =>
      expression.startsWith("({href:") ? before : true,
    );
    await page.waitForNavigation(
      async () => {
        expect(endpoint.commands[0]?.params.expression).toBe(
          "({href:location.href,timeOrigin:performance.timeOrigin})",
        );
      },
      { url: "/done" },
    );
    expect(endpoint.commands.at(-1)?.params.expression).toContain("performance.timeOrigin !== 1");
  });

  it("detects expanded phone viewports and still saves evidence screenshots", async () => {
    const report = {
      requestedWidth: 390,
      innerWidth: 448,
      documentWidth: 448,
      bodyWidth: 448,
      offenders: [
        {
          tag: "TABLE",
          width: 448,
          scrollWidth: 448,
          right: 448,
          left: 0,
          id: "wide",
          className: "",
        },
      ],
    };
    const { page, evidence, directory } = await setup((expression) =>
      expression.includes("requestedWidth:") ? report : true,
    );
    await expect(
      page.captureViewports("broken", [{ name: "phone", width: 390, height: 844, mobile: true }]),
    ).rejects.toThrow(/448.*TABLE/);
    expect(evidence.screenshots[0].viewport.width).toBe(390);
    expect(await readFile(join(directory, evidence.screenshots[0].file), "utf8")).toBe("fake png");
  });

  it("records errors, HTTP failures and canceled requests; allowlists retain evidence", async () => {
    const { page, endpoint, evidence } = await setup(() => true, {
      allowConsoleErrors: [/expected/g],
      allowNetworkFailures: [
        { url: "/missing", status: 404 },
        { url: "/cancel", errorText: "ERR_ABORTED" },
      ],
    });
    endpoint.event("Runtime.consoleAPICalled", {
      type: "error",
      args: [{ value: "expected warning" }],
    });
    endpoint.event("Runtime.exceptionThrown", { exceptionDetails: { text: "expected exception" } });
    endpoint.event("Network.requestWillBeSent", {
      requestId: "1",
      request: { url: "http://local/missing" },
    });
    endpoint.event("Network.responseReceived", {
      requestId: "1",
      response: { url: "http://local/missing", status: 404 },
    });
    endpoint.event("Network.loadingFinished", { requestId: "1" });
    endpoint.event("Network.requestWillBeSent", {
      requestId: "2",
      request: { url: "http://local/cancel" },
    });
    endpoint.event("Network.loadingFailed", {
      requestId: "2",
      errorText: "net::ERR_ABORTED",
      canceled: true,
    });
    await delay(20);
    expect(() => page.assertHealthy()).not.toThrow();
    expect(evidence.networkFailures).toHaveLength(2);
    expect(evidence.networkFailures.every(({ allowed }) => allowed)).toBe(true);
    expect(evidence.console.every(({ allowed }) => allowed)).toBe(true);
    endpoint.event("Log.entryAdded", { entry: { level: "error", text: "boom: not allowlisted" } });
    endpoint.event("Network.responseReceived", {
      requestId: "3",
      response: { url: "http://local/missing", status: 500 },
    });
    await delay(20);
    expect(() => page.assertHealthy()).toThrow("1 console errors, 1 failed HTTP/network requests");
  });

  it("does not silently pass while an HTTP request remains in flight", async () => {
    const { page, endpoint } = await setup();
    endpoint.event("Network.requestWillBeSent", {
      requestId: "1",
      request: { url: "http://local/slow" },
    });
    await delay(20);
    await expect(page.waitForNetworkIdle(50)).rejects.toThrow(
      "Pending requests: http://local/slow",
    );
  });
});

describe("accessibility scans", () => {
  const violation = {
    id: "label",
    impact: "critical",
    help: "Label inputs",
    helpUrl: "https://example.test/label",
    nodes: [{ target: ["#email"] }, { target: ["#name"] }],
  };
  it("injects axe through CDP, reports selectors and retains failed results", async () => {
    const { page, endpoint, evidence } = await setup((expression) =>
      expression.includes("const results = await axe.run")
        ? { url: "http://fixture/", violations: [structuredClone(violation)], incomplete: [] }
        : true,
    );
    await expect(page.assertAccessible()).rejects.toThrow('label: ["#email"]');
    expect(evidence.accessibility?.[0].violations).toHaveLength(1);
    expect(
      endpoint.commands.some(
        (command) =>
          command.method === "Runtime.evaluate" &&
          String(command.params.expression).includes("axe"),
      ),
    ).toBe(true);
  });
  it("allows exact rule/selector pairs without hiding other nodes", async () => {
    const { page, evidence } = await setup((expression) =>
      expression.includes("const results = await axe.run")
        ? { url: "http://fixture/", violations: [structuredClone(violation)], incomplete: [] }
        : true,
    );
    await expect(
      page.assertAccessible({ allow: [{ id: "label", selector: "#email" }] }),
    ).rejects.toThrow("#name");
    expect(evidence.accessibility?.[0].violations[0].nodes.map((node) => node.allowed)).toEqual([
      true,
      false,
    ]);
    await expect(page.assertAccessible({ allow: [{ id: "label" }] })).resolves.toBeDefined();
  });
  it("retains incomplete checks for manual review on a passing scan", async () => {
    const { page, evidence } = await setup((expression) =>
      expression.includes("const results = await axe.run")
        ? { url: "http://fixture/", violations: [], incomplete: [violation] }
        : true,
    );
    await page.assertAccessible({ selector: "main", tags: ["wcag2aa"] });
    expect(evidence.accessibility?.[0].incomplete).toHaveLength(1);
  });
});
