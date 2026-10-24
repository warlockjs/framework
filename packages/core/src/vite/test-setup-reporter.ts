import { recommendWorkerLifetime } from "../tests/setup-recommendation";

/** Vitest reporter shape, with no runtime dependency on Vitest in the config helper. */
export class TestSetupReporter {
  private files = 0;
  private bootstraps = 0;
  private workers = new Set<string>();
  private totals: Record<string, number> = {};
  private shutdowns = new Map<string, number>();

  public onTestRunStart(): void {
    this.files = 0;
    this.bootstraps = 0;
    this.workers.clear();
    this.totals = {};
    this.shutdowns.clear();
  }

  public onUserConsoleLog(log: { content: string }): void {
    for (const line of log.content.split("\n")) {
      const file = line.startsWith("[warlock:test] file=");
      const summary = line.startsWith("[warlock:test] summary ");
      if (!file && !summary) continue;
      const marker = line.lastIndexOf("pid=");
      if (marker === -1) continue;
      const [pid, ...parts] = line
        .slice(marker + 4)
        .trim()
        .split(/\s+/);
      if (!pid || !/^\d+$/.test(pid)) continue;
      const steps: Record<string, number> = {};
      for (const part of parts) {
        const match = /^([a-zA-Z]+)=(\d+(?:\.\d+)?)ms$/.exec(part);
        if (match?.[1] && match[2]) steps[match[1]] = Number(match[2]);
      }
      if (summary) {
        if (steps.shutdown !== undefined) this.shutdowns.set(pid, steps.shutdown);
        continue;
      }
      this.workers.add(pid);
      this.files += 1;
      if (steps.bootstrap !== undefined) this.bootstraps += 1;
      for (const [step, ms] of Object.entries(steps))
        this.totals[step] = (this.totals[step] ?? 0) + ms;
    }
  }

  public onTestRunEnd(): void {
    if (!this.files) return;
    const shutdown = [...this.shutdowns.values()].reduce((sum, ms) => sum + ms, 0);
    const steps = Object.entries({ ...this.totals, shutdown })
      .map(([step, ms]) => `${step}=${ms.toFixed(2)}ms`)
      .join(" ");
    console.info(
      `[warlock:test] run summary files=${this.files} workers=${this.workers.size} bootstraps=${this.bootstraps} ${steps}`,
    );
    const { body = 0, ...setup } = { ...this.totals, shutdown };
    const advice = recommendWorkerLifetime({
      files: this.files,
      bootstraps: this.bootstraps,
      setupMs: Object.values(setup).reduce((sum, ms) => sum + ms, 0),
      bodyMs: body,
    });
    if (advice) console.info(advice);
  }
}
