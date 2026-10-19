import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CdpConnection } from "./cdp";
import { isolatedEnvironment } from "./fixture";
import { OwnedProcess } from "./owned-process";
import type { BrowserOptions, E2EEvidence } from "./types";

export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const names =
    platform === "win32"
      ? ["chrome.exe", "msedge.exe"]
      : [
          "google-chrome",
          "google-chrome-stable",
          "chromium",
          "chromium-browser",
          "microsoft-edge",
          "microsoft-edge-stable",
        ];
  const paths = (env.PATH ?? "")
    .split(platform === "win32" ? ";" : delimiter)
    .filter(Boolean)
    .flatMap((path) => names.map((name) => join(path, name)));
  if (platform === "darwin")
    paths.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      join(env.HOME ?? "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      join(env.HOME ?? "", "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    );
  if (platform === "win32")
    for (const root of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (path): path is string => Boolean(path),
    ))
      paths.push(
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
  return paths;
}

export async function findBrowserBinary(
  override = process.env.WARLOCK_E2E_BROWSER,
): Promise<string | undefined> {
  const candidates = override
    ? [resolve(override)]
    : browserCandidates(process.platform, process.env);
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      /* Try the next known installation. */
    }
  }
  if (override) throw new Error(`Browser override is not executable: ${override}`);
  return undefined;
}

export class OwnedBrowser {
  connection?: CdpConnection;
  process?: OwnedProcess;
  constructor(
    private root: string,
    private evidence: E2EEvidence,
  ) {}

  async start(options: BrowserOptions = {}, signal?: AbortSignal): Promise<CdpConnection> {
    const binary = await findBrowserBinary(options.binary);
    if (!binary)
      throw new Error(
        "No Chrome or Edge binary found. Install one or set --browser / WARLOCK_E2E_BROWSER to its executable path.",
      );
    if (
      options.args?.some(
        (arg) =>
          !arg.startsWith("--") || /^--(?:user-data-dir|remote-debugging|headless)/.test(arg),
      )
    )
      throw new Error(
        "Browser args must be flags and cannot replace the owned profile, debugging endpoint, or headless mode",
      );
    const profile = join(this.root, "browser-profile");
    await mkdir(profile, { recursive: true });
    // Headless flag: https://developer.chrome.com/docs/chromium/headless
    // Port 0 and discovery: https://chromedevtools.github.io/devtools-protocol/#how-do-i-access-the-browser-target
    // Profile required by Chrome 136+: https://developer.chrome.com/blog/remote-debugging-port
    this.process = await OwnedProcess.start(
      "browser",
      [
        binary,
        "--headless",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        ...(options.args ?? []),
        "about:blank",
      ],
      this.root,
      isolatedEnvironment(this.root, {}),
      this.root,
      this.evidence.processes,
      (owned) => {
        this.process = owned;
      },
    );
    const deadline = Date.now() + 15_000;
    let reason = "DevToolsActivePort is not ready";
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      this.process.assertRunning();
      try {
        const port = Number(
          (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0],
        );
        if (!Number.isInteger(port) || port <= 0 || port > 65535)
          throw new Error("Invalid owned browser debugging port");
        // HTTP discovery endpoints: https://chromedevtools.github.io/devtools-protocol/#http-endpoints
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(1000),
        });
        if (!response.ok) throw new Error(`CDP discovery returned HTTP ${response.status}`);
        const targets = (await response.json()) as {
          type: string;
          url: string;
          webSocketDebuggerUrl?: string;
        }[];
        const target = targets.find(
          (candidate) => candidate.type === "page" && candidate.url === "about:blank",
        );
        if (!target?.webSocketDebuggerUrl)
          throw new Error("Owned browser has no about:blank page target");
        const endpoint = new URL(target.webSocketDebuggerUrl);
        if (
          endpoint.protocol !== "ws:" ||
          endpoint.hostname !== "127.0.0.1" ||
          Number(endpoint.port) !== port
        )
          throw new Error("CDP discovery returned a non-owned endpoint");
        this.connection = await CdpConnection.connect(endpoint.href);
        return this.connection;
      } catch (error) {
        reason = String(error);
        await delay(50);
      }
    }
    throw new Error(`Browser startup timed out: ${reason}\n${this.process.logs().slice(-8000)}`);
  }

  async stop(): Promise<void> {
    this.connection?.close();
    await this.process?.stop();
  }
}
