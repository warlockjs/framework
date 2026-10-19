import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OwnedBrowser } from "./browser";
import { AppFixture } from "./fixture";
import { BrowserPage } from "./page";
import { errorMessage, type E2EEvidence, type E2ESpec, type RunE2EOptions } from "./types";

export type E2EResult = { outputDirectory: string; evidenceFile: string; evidence: E2EEvidence };
export class E2ERunError extends Error {
  constructor(readonly result: E2EResult) {
    super(
      `Browser e2e failed: ${result.evidence.errors.join("; ")}\nEvidence: ${result.evidenceFile}`,
    );
    this.name = "E2ERunError";
  }
}

/** Each invocation owns a fresh app copy, data root, process groups, profile,
 * screenshots and evidence file. Failures still publish evidence after cleanup.
 */
export async function runE2E(spec: E2ESpec, options: RunE2EOptions = {}): Promise<E2EResult> {
  if (!spec || !spec.app || typeof spec.run !== "function")
    throw new Error("An e2e spec must default-export defineE2E({ app, run })");
  const base = resolve(options.outputDirectory ?? ".warlock/e2e");
  await mkdir(base, { recursive: true });
  const outputDirectory = await mkdtemp(join(base, "run-"));
  const started = performance.now();
  const evidence: E2EEvidence = {
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
  const result: E2EResult = {
    outputDirectory,
    evidenceFile: join(outputDirectory, "evidence.json"),
    evidence,
  };
  let fixture: AppFixture | undefined;
  let browser: OwnedBrowser | undefined;
  let page: BrowserPage | undefined;
  const abort = new AbortController();
  const forwardAbort = () =>
    abort.abort(options.signal?.reason ?? new Error("Browser e2e aborted"));
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const onInterrupt = () => abort.abort(new Error("Browser e2e interrupted (SIGINT)"));
  const onTerminate = () => abort.abort(new Error("Browser e2e interrupted (SIGTERM)"));
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  const timeout = setTimeout(
    () => abort.abort(new Error(`Browser e2e timed out after ${spec.timeoutMs ?? 120_000}ms`)),
    spec.timeoutMs ?? 120_000,
  );
  const aborted = new Promise<never>((_resolve, reject) => {
    if (abort.signal.aborted) reject(abort.signal.reason);
    else abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
  });
  // Attach immediately: fixture startup may take time before the race is awaited.
  void aborted.catch(() => {});
  try {
    abort.signal.throwIfAborted();
    fixture = await AppFixture.create(evidence);
    const context = await fixture.start(spec.app, { ...options, signal: abort.signal });
    abort.signal.throwIfAborted();
    browser = new OwnedBrowser(fixture.root, evidence);
    const connection = await browser.start(
      { ...spec.browser, binary: options.browser ?? spec.browser?.binary },
      abort.signal,
    );
    abort.signal.throwIfAborted();
    page = new BrowserPage(connection, context.url, outputDirectory, evidence, spec);
    await page.initialize();
    const activePage = page;
    await Promise.race([
      aborted,
      spec.run({
        ...context,
        page: activePage,
        evidence,
        outputDirectory,
        signal: abort.signal,
        step: (name, action) => activePage.step(name, action),
      }),
    ]);
    await page.waitForNetworkIdle();
  } catch (error) {
    evidence.errors.push(errorMessage(error));
  } finally {
    clearTimeout(timeout);
    // Capture both widths even when the spec failed. An overflow failure still
    // captures the offending layout and remains a run failure.
    if (page) {
      try {
        await page.captureViewports("final");
      } catch (error) {
        evidence.errors.push(errorMessage(error));
      }
      try {
        await page.waitForNetworkIdle();
      } catch (error) {
        evidence.errors.push(errorMessage(error));
      }
      try {
        page.assertHealthy();
      } catch (error) {
        evidence.errors.push(errorMessage(error));
      }
    }
    if (fixture) {
      for (const owned of fixture.processes) {
        try {
          await writeFile(
            join(outputDirectory, `${owned.record.role}-${owned.record.pid}.log`),
            owned.logs(),
          );
        } catch (error) {
          evidence.errors.push(`Writing process log: ${errorMessage(error)}`);
        }
      }
    }
    if (browser?.process) {
      try {
        await writeFile(
          join(outputDirectory, `browser-${browser.process.record.pid}.log`),
          browser.process.logs(),
        );
      } catch (error) {
        evidence.errors.push(`Writing browser log: ${errorMessage(error)}`);
      }
    }
    try {
      await browser?.stop();
    } catch (error) {
      evidence.errors.push(`Browser teardown: ${errorMessage(error)}`);
    }
    // Never remove a live browser profile after an identity verification failure.
    if (browser?.process && !browser.process.record.stopped) {
      evidence.errors.push(
        `Fixture files retained at ${fixture?.root}: browser could not be safely stopped`,
      );
      const stopped = await Promise.allSettled(
        fixture?.processes.map((owned) => owned.stop()) ?? [],
      );
      for (const entry of stopped)
        if (entry.status === "rejected") evidence.errors.push(errorMessage(entry.reason));
    } else {
      try {
        await fixture?.stop();
      } catch (error) {
        evidence.errors.push(`App teardown: ${errorMessage(error)}`);
      }
    }
    options.signal?.removeEventListener("abort", forwardAbort);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    evidence.durationMs = Math.round(performance.now() - started);
    evidence.status = evidence.errors.length ? "failed" : "passed";
    await writeFile(result.evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
  }
  if (evidence.status === "failed") throw new E2ERunError(result);
  return result;
}
