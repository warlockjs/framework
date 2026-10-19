import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  lstat,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OwnedProcess } from "./owned-process";
import type {
  AppFixtureOptions,
  Command,
  E2EEvidence,
  FixtureContext,
  RunE2EOptions,
} from "./types";

/** Deliberately does not inherit app secrets, NODE_OPTIONS, or service endpoints. */
export function isolatedEnvironment(
  directory: string,
  additions: Record<string, string>,
  paths: string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    ...additions,
    HOME: join(directory, "home"),
    USERPROFILE: join(directory, "home"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_CACHE_HOME: join(directory, "cache"),
    TMPDIR: join(directory, "tmp"),
    TEMP: join(directory, "tmp"),
    TMP: join(directory, "tmp"),
    PATH: [...paths, env.PATH ?? ""].join(delimiter),
  };
}

async function reservePort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve an ephemeral fixture port");
  return {
    port: address.port,
    release: () =>
      new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      ),
  };
}

async function linkDependencies(source: string, target: string): Promise<void> {
  // A workspace app may resolve dependencies from a parent node_modules.
  let current = source;
  while (true) {
    const modules = join(current, "node_modules");
    try {
      if ((await stat(modules)).isDirectory()) {
        await symlink(
          await realpath(modules),
          join(target, "node_modules"),
          process.platform === "win32" ? "junction" : "dir",
        );
        return;
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export class AppFixture {
  readonly processes: OwnedProcess[] = [];
  context?: FixtureContext;
  private constructor(
    readonly root: string,
    private evidence: E2EEvidence,
  ) {}

  static async create(evidence: E2EEvidence): Promise<AppFixture> {
    return new AppFixture(await mkdtemp(join(tmpdir(), "warlock-e2e-")), evidence);
  }

  async start(options: AppFixtureOptions, runOptions: RunE2EOptions): Promise<FixtureContext> {
    runOptions.signal?.throwIfAborted();
    const source = await realpath(resolve(options.directory ?? process.cwd()));
    const directory = join(this.root, "app");
    const dataRoot = join(this.root, "data");
    const portFile = join(this.root, "port");
    const output = relative(source, resolve(runOptions.outputDirectory ?? ".warlock/e2e"));
    const excluded = [
      "node_modules",
      ".git",
      ".warlock",
      ...(output && !output.startsWith("..") && !isAbsolute(output) ? [output] : []),
      ...(options.exclude ?? []),
    ];
    if (excluded.some((entry) => isAbsolute(entry) || entry.split(/[\\/]/).includes("..")))
      throw new Error("Fixture exclusions must be relative paths without '..'");
    await cp(source, directory, {
      recursive: true,
      // Never copy dotenv files or follow symlinks into shared app data.
      dereference: false,
      filter: async (file) => {
        const path = relative(source, file);
        if (!path) return true;
        if (file === this.root || this.root.startsWith(`${file}${sep}`)) return false;
        const segments = path.split(sep);
        if (segments.some((entry) => entry === ".env" || entry.startsWith(".env."))) return false;
        if (
          excluded.some(
            (entry) =>
              path === entry ||
              path.startsWith(`${entry}${sep}`) ||
              (entry === "node_modules" && segments.includes(entry)),
          )
        )
          return false;
        return !(await lstat(file).catch(() => undefined))?.isSymbolicLink();
      },
    });
    // cp preserves links by default; reject app links to keep writes disposable.
    // Dependencies are the sole explicit read-only-by-contract shared link.
    await linkDependencies(source, directory);
    for (const path of [dataRoot, "home", "config", "cache", "tmp"].map((path) =>
      isAbsolute(path) ? path : join(this.root, path),
    ))
      await mkdir(path, { recursive: true });
    const reservation = await reservePort();
    const context: FixtureContext = {
      directory,
      dataRoot,
      port: reservation.port,
      url: `http://127.0.0.1:${reservation.port}`,
      portFile,
    };
    this.context = context;
    try {
      await options.prepare?.(context);
      runOptions.signal?.throwIfAborted();
      const additions =
        typeof options.env === "function" ? options.env(context) : (options.env ?? {});
      const env = isolatedEnvironment(
        this.root,
        {
          NODE_ENV: "production",
          ...additions,
          HOST: "127.0.0.1",
          HTTP_HOST: "127.0.0.1",
          PORT: String(options.portFromFile ? 0 : context.port),
          HTTP_PORT: String(options.portFromFile ? 0 : context.port),
          WARLOCK_E2E_DATA_ROOT: dataRoot,
          WARLOCK_E2E_PORT_FILE: portFile,
        },
        [...(runOptions.path ?? []), ...(options.path ?? [])].map((path) =>
          resolve(directory, path),
        ),
      );
      // A framework env() consumer sees the same owned variables as process.env.
      await writeFile(
        join(directory, ".env"),
        Object.entries(env)
          .map(([key, value]) => `${key}=${JSON.stringify(value ?? "")}`)
          .join("\n") + "\n",
        { mode: 0o600 },
      );
      const timeoutMs = options.startupTimeoutMs ?? 30_000;
      if (options.build) {
        const command =
          typeof options.build === "function" ? options.build(context) : options.build;
        const build = await OwnedProcess.start(
          "build",
          command,
          directory,
          env,
          this.root,
          this.evidence.processes,
          (owned) => this.processes.push(owned),
        );
        await build.wait(timeoutMs, runOptions.signal);
        await build.stop();
      }
      await reservation.release();
      runOptions.signal?.throwIfAborted();
      const command: Command =
        typeof options.start === "function"
          ? options.start(context)
          : (options.start ?? [process.execPath, "dist/app.js"]);
      const app = await OwnedProcess.start(
        "app",
        command,
        directory,
        env,
        this.root,
        this.evidence.processes,
        (owned) => this.processes.push(owned),
      );
      const deadline = Date.now() + timeoutMs;
      let reason = "No successful readiness response";
      while (Date.now() < deadline) {
        runOptions.signal?.throwIfAborted();
        app.assertRunning();
        try {
          if (options.portFromFile) {
            const port = Number((await readFile(portFile, "utf8")).trim());
            if (!Number.isInteger(port) || port <= 0 || port > 65535)
              throw new Error("Port file must contain a bound TCP port between 1 and 65535");
            context.port = port;
            context.url = `http://127.0.0.1:${port}`;
          }
          const ready = new URL(options.readyPath ?? "/", context.url);
          if (ready.origin !== context.url)
            throw new Error("Readiness URL must stay on the fixture origin");
          const response = await fetch(ready, {
            redirect: "manual",
            signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))),
          });
          await response.body?.cancel();
          if (response.status >= 200 && response.status < 400) {
            // Give foreground startup failures a chance to arrive over IPC.
            await delay(100);
            app.assertRunning();
            this.evidence.url = context.url;
            return context;
          }
          reason = `Readiness HTTP ${response.status}`;
        } catch (error) {
          reason = String(error);
        }
        await delay(50);
      }
      throw new Error(`App readiness timed out: ${reason}\n${app.logs().slice(-8000)}`);
    } finally {
      await reservation.release().catch(() => {});
    }
  }

  async stop(): Promise<void> {
    const results = await Promise.allSettled(this.processes.map((process) => process.stop()));
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(
        errors,
        "Owned fixture teardown failed; disposable files retained for inspection: " +
          errors.map(String).join("; "),
      );
    await rm(this.root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
