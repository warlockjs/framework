import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CdpConnection, CdpTimeoutError } from "./cdp";
import {
  type AccessibilityOptions,
  type AccessibilityEvidence,
  defaultViewports,
  errorMessage,
  matches,
  type E2EEvidence,
  type E2ESpec,
  type PayloadEvidence,
  type Viewport,
} from "./types";

type WaitOptions = { selector?: string; text?: string; url?: string; timeoutMs?: number };
type ClickBox = { x: number; y: number; width: number; height: number; reason: string };
type ViewportReport = {
  requestedWidth: number;
  innerWidth: number;
  documentWidth: number;
  bodyWidth: number;
  offenders: {
    tag: string;
    id: string;
    className: string;
    width: number;
    scrollWidth: number;
    right: number;
    left: number;
  }[];
};

/** Runs inside the browser. Two paints plus cross-probe box comparison detect
 * scroll/animation/layout races. The hit test also accepts target descendants.
 */
function clickProbe(selector: string): Promise<ClickBox> {
  return (async () => {
    const empty = (reason: string): ClickBox => ({ x: 0, y: 0, width: 0, height: 0, reason });
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement || element instanceof SVGElement))
      return empty("target is missing or is not an HTML/SVG element");
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (!element.isConnected || document.querySelector(selector) !== element)
      return empty("target was replaced during layout");
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const style = getComputedStyle(element);
    let reason = "";
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      style.visibility !== "visible" ||
      style.display === "none" ||
      Number(style.opacity) === 0
    )
      reason = "target is hidden or has an empty box";
    else if (element.matches(":disabled") || element.closest('[inert], [aria-disabled="true"]'))
      reason = "target is disabled or inert";
    else if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
      reason = "target center is outside the viewport";
    else {
      const top = document.elementFromPoint(x, y);
      if (!top || !element.contains(top))
        reason = `target is covered by ${top?.tagName ?? "no element"}${top?.id ? "#" + top.id : ""}`;
    }
    return { x, y, width: box.width, height: box.height, reason };
  })();
}

export function boxesStable(first: ClickBox, second: ClickBox): boolean {
  return (
    !first.reason &&
    !second.reason &&
    (["x", "y", "width", "height"] as const).every(
      (key) => Math.abs(first[key] - second[key]) < 0.25,
    )
  );
}

/** Reason to report after a failed probe in a retry loop. A CDP timeout comes from
 * the deadline shrinking under the probe, not from the target, so it must not
 * replace a reason already observed on the target. Any other error is reported.
 */
function probeReason(error: unknown, observed: string | undefined): string {
  if (error instanceof CdpTimeoutError && observed !== undefined) return observed;
  return errorMessage(error);
}

export class BrowserPage {
  private viewport: Viewport = { ...defaultViewports[0] };
  private loads = 0;
  private pendingRequests = new Map<string, string>();
  private requestUrls = new Map<string, string>();
  private lastNetworkActivity = Date.now();

  constructor(
    private cdp: CdpConnection,
    private origin: string,
    private outputDirectory: string,
    private evidence: E2EEvidence,
    private spec: E2ESpec,
  ) {
    cdp.on("Page.loadEventFired", () => {
      this.loads++;
    });
    cdp.on("Runtime.consoleAPICalled", ({ type, args }) =>
      evidence.console.push({
        at: new Date().toISOString(),
        level: type === "assert" ? "error" : type,
        text: args.map((arg) => String(arg.value ?? arg.description ?? "")).join(" "),
      }),
    );
    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) =>
      evidence.console.push({
        at: new Date().toISOString(),
        level: "error",
        text: exceptionDetails.exception?.description ?? exceptionDetails.text,
      }),
    );
    cdp.on("Log.entryAdded", ({ entry }) =>
      evidence.console.push({ at: new Date().toISOString(), level: entry.level, text: entry.text }),
    );
    cdp.on("Network.requestWillBeSent", ({ requestId, request }) => {
      this.pendingRequests.set(requestId, request.url);
      this.requestUrls.set(requestId, request.url);
      this.lastNetworkActivity = Date.now();
    });
    cdp.on("Network.responseReceived", ({ requestId, response }) => {
      this.requestUrls.set(requestId, response.url);
      if (response.status >= 400)
        evidence.networkFailures.push({
          at: new Date().toISOString(),
          url: response.url,
          status: response.status,
        });
    });
    cdp.on("Network.loadingFailed", ({ requestId, errorText, canceled }) => {
      evidence.networkFailures.push({
        at: new Date().toISOString(),
        url: this.requestUrls.get(requestId) ?? `unknown request ${requestId}`,
        errorText,
        canceled,
      });
      this.completeRequest(requestId);
    });
    cdp.on("Network.loadingFinished", ({ requestId }) => this.completeRequest(requestId));
  }

  private completeRequest(requestId: string): void {
    this.pendingRequests.delete(requestId);
    this.requestUrls.delete(requestId);
    this.lastNetworkActivity = Date.now();
  }

  async initialize(): Promise<void> {
    await this.cdp.command("Page.enable", {});
    await this.cdp.command("Runtime.enable", {});
    await this.cdp.command("Network.enable", {});
    await this.cdp.command("Log.enable", {});
    await this.setViewport(this.spec.viewports?.[0] ?? defaultViewports[0]);
  }

  async step<T>(name: string, action: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const entry = {
      name,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: "passed" as "passed" | "failed",
      error: undefined as string | undefined,
    };
    this.evidence.steps.push(entry);
    try {
      return await action();
    } catch (error) {
      entry.status = "failed";
      entry.error = errorMessage(error);
      throw error;
    } finally {
      entry.durationMs = Math.round(performance.now() - start);
    }
  }

  async evaluate<T = unknown>(expression: string, timeoutMs = 10_000): Promise<T> {
    const response = await this.cdp.command(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, silent: true },
      timeoutMs,
    );
    if (response.exceptionDetails)
      throw new Error(
        `Browser evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`,
      );
    return response.result.value as T;
  }

  private async poll(
    description: string,
    check: (remainingMs: number) => Promise<boolean>,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let reason: string | undefined;
    while (Date.now() < deadline) {
      try {
        if (await check(Math.max(1, deadline - Date.now()))) return;
      } catch (error) {
        reason = probeReason(error, reason);
      }
      await delay(Math.min(50, Math.max(0, deadline - Date.now())));
    }
    throw new Error(
      `${description} timed out after ${timeoutMs}ms: ${reason ?? "condition stayed false"}`,
    );
  }

  async goto(path: string, timeoutMs = 10_000): Promise<void> {
    await this.step(`goto ${path}`, async () => {
      const url = new URL(path, this.origin).href;
      const before = this.loads;
      const navigation = await this.cdp.command("Page.navigate", { url }, timeoutMs);
      if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
      await this.poll(
        `Navigation to ${url}`,
        (remaining) =>
          this.evaluate<boolean>(
            `document.readyState === 'complete' && ${navigation.loaderId ? this.loads > before : "true"}`,
            remaining,
          ),
        timeoutMs,
      );
    });
  }

  async waitFor(options: WaitOptions): Promise<void> {
    if (options.selector === undefined && options.text === undefined && options.url === undefined)
      throw new Error("waitFor requires a selector, text, or URL");
    await this.step(`waitFor ${JSON.stringify(options)}`, () =>
      this.poll(
        "waitFor " + JSON.stringify(options),
        (remaining) =>
          this.evaluate<boolean>(
            `(() => {
      const options = ${JSON.stringify(options)};
      const element = options.selector ? document.querySelector(options.selector) : document.body;
      if (!element) return false;
      if (options.selector) { const box=element.getBoundingClientRect(); const css=getComputedStyle(element); if (!box.width || !box.height || css.visibility !== 'visible') return false; }
      return (options.text === undefined || (element.innerText ?? element.textContent ?? '').includes(options.text)) &&
        (options.url === undefined || location.href === new URL(options.url, ${JSON.stringify(this.origin)}).href);
    })()`,
            remaining,
          ),
        options.timeoutMs ?? 10_000,
      ),
    );
  }

  /** Arms the document/URL comparison BEFORE invoking the navigation action,
   * covering full loads, reloads, hash changes and client-side routing.
   */
  async waitForNavigation(
    action: () => Promise<unknown>,
    options: { url?: string; timeoutMs?: number } = {},
  ): Promise<void> {
    await this.step("waitForNavigation", async () => {
      const before = await this.evaluate<{ href: string; timeOrigin: number }>(
        "({href:location.href,timeOrigin:performance.timeOrigin})",
      );
      await action();
      await this.poll(
        "Navigation",
        (remaining) =>
          this.evaluate<boolean>(
            `document.readyState === 'complete' && (location.href !== ${JSON.stringify(before.href)} || performance.timeOrigin !== ${before.timeOrigin}) && ${options.url ? `location.href === ${JSON.stringify(new URL(options.url, this.origin).href)}` : "true"}`,
            remaining,
          ),
        options.timeoutMs ?? 10_000,
      );
    });
  }

  async click(selector: string, timeoutMs = 10_000): Promise<void> {
    await this.step(`click ${selector}`, async () => {
      const deadline = Date.now() + timeoutMs;
      let previous: ClickBox | undefined;
      let reason: string | undefined;
      while (Date.now() < deadline) {
        const remaining = () => Math.max(1, deadline - Date.now());
        let box: ClickBox;
        try {
          box = await this.evaluate<ClickBox>(
            `(${clickProbe.toString()})(${JSON.stringify(selector)})`,
            remaining(),
          );
        } catch (error) {
          reason = probeReason(error, reason);
          previous = undefined;
          await delay(25);
          continue;
        }
        reason = box.reason || "target box is moving";
        if (previous && boxesStable(previous, box)) {
          // Hover can move menus and overlays. Re-measure and hit-test after it.
          let hovered: ClickBox;
          try {
            await this.cdp.command(
              "Input.dispatchMouseEvent",
              { type: "mouseMoved", x: box.x, y: box.y },
              remaining(),
            );
            hovered = await this.evaluate<ClickBox>(
              `(${clickProbe.toString()})(${JSON.stringify(selector)})`,
              remaining(),
            );
          } catch (error) {
            reason = probeReason(error, reason);
            previous = undefined;
            await delay(Math.min(25, remaining()));
            continue;
          }
          if (Date.now() < deadline && boxesStable(box, hovered)) {
            await this.cdp.command(
              "Input.dispatchMouseEvent",
              {
                type: "mousePressed",
                x: hovered.x,
                y: hovered.y,
                button: "left",
                buttons: 1,
                clickCount: 1,
              },
              remaining(),
            );
            await this.cdp.command(
              "Input.dispatchMouseEvent",
              {
                type: "mouseReleased",
                x: hovered.x,
                y: hovered.y,
                button: "left",
                buttons: 0,
                clickCount: 1,
              },
              remaining(),
            );
            return;
          }
          reason = hovered.reason || "hover changed the target box";
          previous = undefined;
        } else previous = box;
        await delay(Math.min(50, remaining()));
      }
      throw new Error(
        `Cannot click ${JSON.stringify(selector)} within ${timeoutMs}ms: ${reason ?? "layout has not settled"}`,
      );
    });
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.step(`fill ${selector}`, async () => {
      await this.click(selector);
      // The native value setter works with controlled inputs; input/change are
      // emitted after clearing. CDP insertText then performs actual text input.
      await this.evaluate(`(() => {
        const element=document.querySelector(${JSON.stringify(selector)});
        if (element !== document.activeElement) throw new Error('Fill target lost focus');
        if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && !element.readOnly && !element.disabled) {
          const prototype=element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;
          if (!setter) throw new Error('Fill target has no native value setter');
          setter.call(element,'');
        } else if (element instanceof HTMLElement && element.isContentEditable) element.textContent='';
        else throw new Error('Fill target must be an editable input, textarea or contenteditable');
        element.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await this.evaluate(
        `document.activeElement === document.querySelector(${JSON.stringify(selector)}) || (() => { throw new Error("Fill target lost focus after input"); })()`,
      );
      if (value) await this.cdp.command("Input.insertText", { text: value });
      await this.evaluate(
        "document.activeElement?.dispatchEvent(new Event('change',{bubbles:true}))",
      );
    });
  }

  /** Appends Unicode text through the browser's text-input path. */
  async type(selector: string, text: string): Promise<void> {
    await this.step(`type ${selector}`, async () => {
      await this.click(selector);
      const needsEndKey = await this.evaluate<boolean>(
        `(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (element !== document.activeElement || !((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && !element.readOnly && !element.disabled || element instanceof HTMLElement && element.isContentEditable)) throw new Error('Type target is not focused and editable'); if(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) { if (typeof element.selectionStart !== "number") return true; element.setSelectionRange(element.value.length,element.value.length); } else { const range=document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection=getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } return false; })()`,
      );
      // Email/number inputs do not expose selectionRange; use their native
      // keyboard editing path instead of throwing on setSelectionRange.
      if (needsEndKey) {
        await this.cdp.command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "End",
          code: "End",
          windowsVirtualKeyCode: 35,
        });
        await this.cdp.command("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "End",
          code: "End",
          windowsVirtualKeyCode: 35,
        });
      }
      await this.cdp.command("Input.insertText", { text });
    });
  }

  async setViewport(viewport: Viewport): Promise<void> {
    if (
      !/^[a-z0-9_-]+$/i.test(viewport.name) ||
      !Number.isInteger(viewport.width) ||
      !Number.isInteger(viewport.height) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    )
      throw new Error("Viewport requires a safe name and positive integer width/height");
    await this.step(`viewport ${viewport.name} ${viewport.width}x${viewport.height}`, async () => {
      await this.cdp.command("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile ?? false,
      });
      this.viewport = { ...viewport };
      await this.evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
      );
    });
  }

  /** Inject the installed axe distribution through Runtime.evaluate on every scan.
   * API: https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#api-name-axerun
   * No CDN, DOM script element, or application dependency is required.
   */
  /**
   * Measures the inline payload of the document the page currently shows and
   * records it under `evidence.payloads`. Measure after a full load: a client
   * navigation replaces the data it reads. Pass `limit` to mark an overage.
   */
  async measurePayload(options: { limit?: number } = {}): Promise<PayloadEvidence> {
    return this.step(`measurePayload ${this.viewport.name}`, async () => {
      const measured = await this.evaluate<Pick<PayloadEvidence, "url" | "data" | "routes">>(
        `(() => {
          const bytes = (id) => {
            const node = document.getElementById(id);
            return node === null ? 0 : new TextEncoder().encode(node.textContent || "").length;
          };
          return { url: location.href, data: bytes("__WARLOCK_DATA__"), routes: bytes("__WARLOCK_NAMED_API_ROUTES__") };
        })()`,
        10_000,
      );
      const total = measured.data + measured.routes;
      const report: PayloadEvidence = {
        at: new Date().toISOString(),
        viewport: { ...this.viewport },
        ...measured,
        total,
        ...(options.limit === undefined
          ? {}
          : { limit: options.limit, overBudget: total > options.limit }),
      };
      (this.evidence.payloads ??= []).push(report);
      return report;
    });
  }

  async assertAccessible(options: AccessibilityOptions = {}): Promise<AccessibilityEvidence> {
    return this.step(`assertAccessible ${this.viewport.name}`, async () => {
      const source = await readFile(
        createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
        "utf8",
      );
      const timeout = options.timeoutMs ?? 30_000;
      await this.evaluate(source, timeout);
      const result = await this.evaluate<
        Pick<AccessibilityEvidence, "url" | "violations" | "incomplete">
      >(
        `(async () => {
        const selector = ${JSON.stringify(options.selector ?? null)};
        const context = selector === null ? document : document.querySelector(selector);
        if (!context) throw new Error('Accessibility scan selector did not match: ' + selector);
        const results = await axe.run(context, ${JSON.stringify(options.tags ? { runOnly: { type: "tag", values: options.tags } } : {})});
        const summarize = entries => entries.map(({id, impact, help, helpUrl, nodes}) => ({
          id, impact, help, helpUrl, nodes: nodes.map(({target, failureSummary}) => ({target, failureSummary}))
        }));
        return {url: location.href, violations: summarize(results.violations), incomplete: summarize(results.incomplete)};
      })()`,
        timeout,
      );
      for (const violation of result.violations) {
        for (const node of violation.nodes) {
          node.allowed =
            options.allow?.some(
              (rule) =>
                rule.id === violation.id &&
                (rule.selector === undefined ||
                  (node.target.length === 1 && node.target[0] === rule.selector)),
            ) ?? false;
        }
      }
      const report = { at: new Date().toISOString(), viewport: { ...this.viewport }, ...result };
      (this.evidence.accessibility ??= []).push(report);
      const failures = report.violations.flatMap((violation) =>
        violation.nodes
          .filter((node) => !node.allowed)
          .map((node) => `${violation.id}: ${JSON.stringify(node.target)} — ${violation.help}`),
      );
      if (failures.length) throw new Error(`Accessibility violations:\n${failures.join("\n")}`);
      return report;
    });
  }

  async assertViewport(): Promise<ViewportReport> {
    return this.step(`assertViewport ${this.viewport.name}`, async () => {
      const report = await this.evaluate<ViewportReport>(`({
        requestedWidth:${this.viewport.width},innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body?.scrollWidth ?? 0,
        offenders:[...document.querySelectorAll('*')].map(element=>{const box=element.getBoundingClientRect();return {tag:element.tagName,id:element.id,className:element.getAttribute('class')??'',width:box.width,scrollWidth:element.scrollWidth,right:box.right,left:box.left}})
          .filter(element=>element.right>${this.viewport.width} || element.left<0 || element.width>${this.viewport.width} || element.scrollWidth>${this.viewport.width})
          .sort((a,b)=>Math.max(b.width,b.scrollWidth,b.right)-Math.max(a.width,a.scrollWidth,a.right)).slice(0,10)
      })`);
      if (
        report.innerWidth !== report.requestedWidth ||
        report.documentWidth > report.requestedWidth ||
        report.bodyWidth > report.requestedWidth
      )
        throw new Error(
          `Horizontal overflow or expanded viewport at ${this.viewport.name}: ${JSON.stringify(report)}`,
        );
      return report;
    });
  }

  async screenshot(name: string): Promise<string> {
    if (!/^[a-z0-9_-]+$/i.test(name))
      throw new Error("Screenshot names must contain only letters, digits, '_' or '-'");
    return this.step(`screenshot ${name}`, async () => {
      const file = `${String(this.evidence.screenshots.length + 1).padStart(3, "0")}-${name}-${this.viewport.name}.png`;
      const { data } = await this.cdp.command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(this.outputDirectory, file), Buffer.from(data, "base64"));
      this.evidence.screenshots.push({ name, file, viewport: { ...this.viewport } });
      return join(this.outputDirectory, file);
    });
  }

  async captureViewports(
    name: string,
    viewports = this.spec.viewports ?? defaultViewports,
  ): Promise<void> {
    const failures: unknown[] = [];
    const original = this.viewport;
    for (const viewport of viewports) {
      try {
        await this.setViewport(viewport);
        try {
          await this.assertViewport();
        } finally {
          await this.screenshot(name);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this.setViewport(original);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, failures.map(errorMessage).join("; "));
  }

  async waitForNetworkIdle(timeoutMs = 10_000): Promise<void> {
    await this.step("waitForNetworkIdle", () =>
      this.poll(
        "Network idle",
        async () => {
          const pending = [...this.pendingRequests.values()].filter(
            (url) => !this.spec.allowPendingRequests?.some((pattern) => matches(pattern, url)),
          );
          if (pending.length) throw new Error(`Pending requests: ${pending.join(", ")}`);
          return Date.now() - this.lastNetworkActivity >= 300;
        },
        timeoutMs,
      ),
    );
  }

  assertHealthy(): void {
    for (const entry of this.evidence.console)
      if (entry.level === "error")
        entry.allowed =
          this.spec.allowConsoleErrors?.some((pattern) => matches(pattern, entry.text)) ?? false;
    for (const entry of this.evidence.networkFailures)
      entry.allowed =
        this.spec.allowNetworkFailures?.some(
          (rule) =>
            matches(rule.url, entry.url) &&
            (rule.status === undefined || rule.status === entry.status) &&
            (rule.errorText === undefined || matches(rule.errorText, entry.errorText ?? "")),
        ) ?? false;
    const consoleErrors = this.evidence.console.filter(
      (entry) => entry.level === "error" && !entry.allowed,
    );
    const networkErrors = this.evidence.networkFailures.filter((entry) => !entry.allowed);
    if (consoleErrors.length || networkErrors.length)
      throw new Error(
        `Browser health failed: ${consoleErrors.length} console errors, ${networkErrors.length} failed HTTP/network requests\n${JSON.stringify({ console: consoleErrors, network: networkErrors })}`,
      );
  }
}
