#!/usr/bin/env node
/**
 * Production acceptance: build the framework, install it into a pnpm-strict
 * app, build that app, start it, and require a real HTTP response.
 *
 * `warlock dev` was the only mode ever exercised, so `build` + `start` shipped
 * broken — a bundle whose bare `@mongez/config` import resolved by accident
 * under npm/yarn hoisting and died under pnpm. Unit tests cannot catch that
 * class: it only appears in a real install, in a real artifact, on a real boot.
 *
 * Two cases run, and both must hold:
 *
 *   POSITIVE  the app declares only `@warlock.js/core`, and still builds,
 *             boots, and serves a request.
 *   NEGATIVE  an undeclared import reintroduced into generated code fails
 *             `warlock build` — the guard against this regressing quietly.
 *
 * Usage:
 *   node core/tests/acceptance/run-pnpm-acceptance.mjs
 *   node core/tests/acceptance/run-pnpm-acceptance.mjs --baseline-only
 *   node core/tests/acceptance/run-pnpm-acceptance.mjs --reuse-stale-artifact-i-know-this-proves-nothing
 *
 * The long flag is deliberate. It reuses whatever artifact happens to be in the
 * builder's output directory, which makes the run fast and its verdict
 * worthless the moment source has moved — the artifact under test stops being
 * the thing you changed. That is not hypothetical: a run was accepted against
 * an artifact built before a dependency change landed, so the change was never
 * exercised, and separately a build resolved its module graph before a new file
 * existed and emitted a call with no import while reporting success.
 *
 * A run using it prints a banner saying its result does not gate a release, and
 * exits non-zero if the artifact is older than any tracked source file.
 */
import { execSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.join(here, "pnpm-production-app");
const coreDirectory = path.resolve(here, "../..");
const warlockRoot = path.resolve(coreDirectory, "..");
const builderDirectory = path.join(warlockRoot, "builder");
const coreBuildsDirectory = path.join(builderDirectory, "builds", "@warlock.js", "core");

const skipFrameworkBuild = process.argv.includes(
  "--reuse-stale-artifact-i-know-this-proves-nothing",
);

/**
 * Run the baseline only — build, boot, serve, and the negative case — and skip
 * the `singleBundle` case.
 *
 * This exists to keep one variable moving at a time. When the harness itself
 * changes (the launcher, the environment, the teardown), a run that also
 * exercises a new feature proves neither: a red result has two candidate causes
 * and a green one is indistinguishable from luck. Land the harness change,
 * confirm the baseline still passes, and only then let the feature case run.
 *
 * The final line says out loud that the feature was skipped, because a
 * shortened run that reports the same "ACCEPTED" as a full one is exactly how a
 * partial verification gets quoted as a complete one.
 */
const baselineOnly = process.argv.includes("--baseline-only");
/**
 * The version the family is built at — read from core's own `package.json`.
 *
 * Passed to `pkgist --bump` explicitly. Without it the build falls back to the
 * family's configured strategy (`patch`), so every acceptance run silently
 * bumped the version: a gate for 4.11.0 built and tested **4.11.1**, and
 * rewrote 27 `package.json` files on its way. A release gate must test the
 * version being released, and must not decide what that version is.
 */
const targetVersion = JSON.parse(
  readFileSync(path.resolve(fileURLToPath(import.meta.url), "../../../package.json"), "utf-8"),
).version;

const acceptancePort = 3711;
const acceptanceUrl = `http://localhost:${acceptancePort}/acceptance`;

/**
 * The environment this gate exists to exercise, set explicitly on every child.
 *
 * It used to be inherited. `env: { ...process.env }` reads as neutral and is
 * not: the shell this harness was written in happened to carry
 * `NODE_ENV=production`, so the gate ran the production path by accident of the
 * operator's environment. On a clean checkout — a new contributor, or CI — the
 * same run boots the app in DEVELOPMENT and passes while testing something
 * other than the thing it is named after.
 *
 * Setting it is half the fix. The run also reads the value back out of the
 * booted app (`assertBootedInProduction`), because a variable that is set and
 * never checked is exactly how this survived in the first place.
 */
const ACCEPTANCE_ENV = { NODE_ENV: "production" };

const log = (message) => console.log(`\n▸ ${message}`);

/**
 * Absolute path to the `warlock` CLI as the fixture actually installed it.
 *
 * Every invocation used to go through `npx pnpm exec warlock`, which cost a
 * measured ~20s of package-manager resolution per launch. Against the 60s
 * readiness budget below that left ~11s of headroom, so the gate spent a third
 * of its own timeout on the launcher and went red after a cold-cache install
 * while the framework was fine. Three warm runs each, same fixture:
 *
 *   npx pnpm exec warlock start   banner at 49.1 / 49.1 / 49.5s
 *   node <this path> start        banner at 31.1 / 26.9 / 28.3s
 *
 * The measurement is the point, not the speed: two thirds of that budget was
 * not ours, so a change that DOUBLED the framework's own boot time would still
 * have passed. Widening the timeout keeps that dishonesty; resolving the binary
 * is the fix.
 *
 * `realpathSync` matters — pnpm's strict layout reaches the package through a
 * symlink, and spawning the link leaves `import.meta.url` pointing somewhere the
 * package's own relative requires do not resolve from.
 */
function resolveWarlockBinary() {
  const binaryPath = path.join(
    appDirectory,
    "node_modules",
    "@warlock.js",
    "core",
    "bin",
    "warlock.js",
  );

  if (!existsSync(binaryPath)) {
    throw new Error(
      [
        `The warlock CLI is not installed at ${binaryPath}.`,
        "",
        "This resolves inside the fixture on purpose: the gate must launch the",
        "binary the app installed, not one hoisted from the workspace root.",
      ].join("\n"),
    );
  }

  return realpathSync(binaryPath);
}

/** Launch the fixture's own `warlock` CLI directly — never through a package manager. */
function warlockCommand(...args) {
  return [process.execPath, [resolveWarlockBinary(), ...args]];
}

/** Run a command to completion, rejecting on a non-zero exit. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      // process.env is inherited deliberately — PATH, the npm/pnpm store paths
      // and the platform's temp directory all have to survive. Every value the
      // VERDICT depends on is set after it, never taken from the caller.
      //
      // `options.env` last is intentional: a caller CAN override NODE_ENV, and
      // that override is CAUGHT rather than PREVENTED — `assertBootedInProduction`
      // reads the value back out of the running app. Keeping the door open is
      // what makes a deliberate negative test possible. Do not tighten this
      // spread to "fix" it; doing so removes the only way to exercise the
      // failure path and buys nothing the assertion doesn't already give.
      env: { ...process.env, ...ACCEPTANCE_ENV, ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      // Windows needs a shell to find `npx`/`pnpm`, which are `.CMD` shims.
      // A caller launching an absolute executable must pass `shell: false`:
      // with a shell, Node concatenates the arguments instead of escaping
      // them, and `process.execPath` on a default install is
      // `C:\Program Files\nodejs\node.exe` — the space alone breaks the
      // command, and it breaks it into something that still LOOKS launchable.
      shell: options.shell ?? process.platform === "win32",
    });

    let output = "";

    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
        process.stderr.write(chunk);
      });
    }

    child.on("error", reject);

    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code, output });

        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

/** The newest version the builder has produced for core. */
function latestCoreVersion() {
  if (!existsSync(coreBuildsDirectory)) {
    throw new Error(
      `No core build found at ${coreBuildsDirectory}. Run the framework build first (drop the reuse flag).`,
    );
  }

  const versions = readdirSync(coreBuildsDirectory).sort((left, right) => {
    return left.localeCompare(right, undefined, { numeric: true });
  });

  const latest = versions.at(-1);

  if (!latest) {
    throw new Error(`No versions under ${coreBuildsDirectory}.`);
  }

  return latest;
}

/**
 * Pack the whole built family into `vendor/`, one tarball per package.
 *
 * Not just core, because Warlock releases in **lockstep**: core@4.11.0 pins
 * `@warlock.js/fs@4.11.0` and six more siblings exactly, and none of them are
 * on the registry until the release publishes. Installing core alone therefore
 * fails on `ERR_PNPM_NO_MATCHING_VERSION` — the acceptance subject is the
 * family, not one package. `pnpm.overrides` in the app redirects every
 * `@warlock.js/*` in the tree to its local tarball.
 *
 * Tarballs, not directories: pnpm symlinks a `file:` directory dependency
 * straight back into the monorepo, which restores the accidental resolution
 * this whole run exists to detect.
 */
/**
 * Assert a built artifact contains the entry points its own manifest declares.
 *
 * A build that is interrupted leaves a directory that looks finished — manifest,
 * README, CHANGELOG, `bin/`, `skills/` — and contains no compiled code at all.
 * Nineteen of them existed in this tree at once, and nothing we owned noticed:
 * the staleness check compares mtimes (a hollow directory with a freshly
 * written `package.json` is *newer* than source and passes), and it only runs
 * on the reuse path anyway.
 *
 * The manifest is the specification. `main`, `module` and the typings field
 * name exactly the files the package promises to ship, so resolving them
 * against the artifact needs no per-package knowledge of build shape — `core`
 * is ESM-only, `cascade` is dual-format, and both are checked correctly by the
 * same rule. Fields a manifest does NOT declare are skipped: asserting a `cjs`
 * entry on a package that legitimately ships ESM only would be a false red, and
 * a gate that cries wolf is a gate people learn to skip.
 *
 * @param artifactDirectory built package directory, containing its package.json
 * @param name package name, for the failure message
 */
function assertArtifactContainsItsEntryPoints(artifactDirectory, name) {
  const manifestPath = path.join(artifactDirectory, "package.json");

  if (!existsSync(manifestPath)) {
    throw new Error(`${name}: no package.json in ${artifactDirectory} — nothing was built.`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  const declaredEntries = [
    ["main", manifest.main],
    ["module", manifest.module],
    ["types", manifest.types ?? manifest.typings],
  ].filter(([, target]) => typeof target === "string" && target.length > 0);

  if (declaredEntries.length === 0) {
    throw new Error(
      `${name}: its package.json declares no main, module or types, so there is nothing to verify. ` +
        `A published package that names no entry point cannot be imported.`,
    );
  }

  const missing = declaredEntries.filter(([, target]) => {
    return !existsSync(path.join(artifactDirectory, target));
  });

  if (missing.length > 0) {
    throw new Error(
      [
        `${name}: the built artifact names entry points it does not contain.`,
        "",
        ...missing.map(([field, target]) => `  ${field}: ${target}  → MISSING`),
        "",
        `  in ${artifactDirectory}`,
        "",
        "This is what an interrupted build leaves behind: a directory carrying a",
        "manifest, docs and bin/ with no compiled output. It looks built. Packing",
        "and shipping it produces a package that cannot be imported at all.",
      ].join("\n"),
    );
  }
}

async function packFramework() {
  const version = latestCoreVersion();
  const scopeDirectory = path.dirname(coreBuildsDirectory);
  const vendorDirectory = path.join(appDirectory, "vendor");

  log(`Packing the @warlock.js family at ${version}`);

  rmSync(vendorDirectory, { recursive: true, force: true });
  mkdirSync(vendorDirectory, { recursive: true });

  const packages = readdirSync(scopeDirectory).filter((name) => {
    return existsSync(path.join(scopeDirectory, name, version));
  });

  for (const name of packages) {
    // Every artifact is checked before it is packed, on the normal build path
    // and the reuse path alike. The hollow directories this catches were
    // produced by an ordinary build that was interrupted — not by anyone
    // reusing an old artifact — so a check living only behind the reuse flag
    // would have missed the only case that has ever actually occurred.
    assertArtifactContainsItsEntryPoints(path.join(scopeDirectory, name, version), name);

    await run("npm", [
      "pack",
      path.join(scopeDirectory, name, version),
      "--pack-destination",
      vendorDirectory,
      "--silent",
    ]);

    const packed = readdirSync(vendorDirectory).find((file) => {
      return file.startsWith(`warlock.js-${name}-`) && file.endsWith(".tgz");
    });

    if (!packed) {
      throw new Error(`npm pack produced no tarball for @warlock.js/${name}`);
    }

    writeFileSync(
      path.join(vendorDirectory, `${name}.tgz`),
      readFileSync(path.join(vendorDirectory, packed)),
    );
    rmSync(path.join(vendorDirectory, packed));
  }

  console.log(`  packed ${packages.length} package(s) at ${version}`);

  return version;
}

/**
 * Kill a process and everything it spawned.
 *
 * `child.kill()` signals only the direct child, and here that child is the
 * `warlock start` CLI — the supervisor it spawns is what actually holds the
 * port. Signalling it leaves the app running, so the NEXT
 * run dies with `EADDRINUSE` on a port nothing visible is using. That happened,
 * and on a CI agent it would make every run after the first fail for a reason
 * that has nothing to do with the code under test.
 */
function killTree(pid) {
  if (process.platform !== "win32") {
    try {
      // Negative pid signals the whole process group.
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone — nothing to clean up.
    }

    return Promise.resolve();
  }

  // Awaited, not fire-and-forget. An unawaited spawn returns before taskkill
  // has done anything, so a check that runs straight afterwards races it and
  // reports a process alive that is merely not dead *yet* — a false failure in
  // the check that exists to catch real ones.
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: true,
    });

    killer.on("error", () => resolve());
    killer.on("exit", () => resolve());
  });
}

/** Whichever pids are listening on a port, according to the OS. */
function findPortHolders(port) {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const output = execSync(`netstat -ano | findstr :${port}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return [
      ...new Set(
        output
          .split("\n")
          .filter((line) => line.includes("LISTENING"))
          .map((line) => line.trim().split(/\s+/).at(-1))
          .filter(Boolean),
      ),
    ];
  } catch {
    // findstr exits non-zero when nothing matches — nothing is listening.
    return [];
  }
}

/** Whether a process id is still alive. Signal 0 tests without signalling. */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

/**
 * Fail unless teardown actually reaped what it claimed to.
 *
 * A cleanup step that reports success without checking is the defect this whole
 * batch is about, and `killTree` is exactly that shape — it signals and returns,
 * with nothing observing whether anything died. Without this assertion a
 * regression is invisible until the NEXT run fails on a port nothing visible is
 * using, which is how the leak got here in the first place.
 *
 * Two checks with deliberately unequal weight, and the asymmetry matters:
 *
 * 1. **The port is released.** This is the check that catches the real leak.
 *    The process that leaks is a *descendant* — the application the CLI
 *    supervises, below what this script spawns — and the port is the only handle
 *    we have on it. A run where teardown failed left the app listening while the
 *    spawned CLI had exited perfectly.
 * 2. **The spawned CLI is gone.** NARROW BY CONSTRUCTION: it observes the
 *    `warlock start` process only, never the application it supervises. That
 *    process essentially always exits, so this check is essentially always
 *    green — it is here to catch a *hung launcher* leaking on a CI agent, and
 *    for nothing else. It must never be read as evidence that the process tree
 *    was reaped; that is what check 1 is for. Its failure message says so,
 *    because a permanently green check that reads as coverage is worse than no
 *    check at all.
 *
 * Residual gap, stated rather than papered over: a tree member that holds
 * neither the port nor the spawned pid escapes both checks.
 *
 * This is a teardown check, deliberately not a pre-bind preflight — core owns
 * that (`assertPortIsAvailable`) and a second implementation would drift.
 */
async function assertTeardownComplete(pid, port, timeoutMs = 10_000) {
  // The port first, because it is the check that can actually catch a leak.
  // Running it second would let the narrow wrapper check fail ahead of it and
  // mask the real finding — which is exactly what happened once.
  await assertPortReleased(port, timeoutMs);

  const deadline = Date.now() + timeoutMs;

  // Polled, not checked once: even an awaited kill leaves a moment before the
  // OS reaps the process, and a single immediate check turns that moment into a
  // failure.
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (isProcessAlive(pid)) {
    throw new Error(
      [
        `The spawned launcher (pid ${pid}) was still alive ${timeoutMs}ms after teardown.`,
        "",
        "Scope: this observes the `warlock start` process ONLY — never the application",
        "it supervises. The port check above is what proves the application was",
        "reaped. A hung launcher leaks a process on a CI agent, which is the only",
        "thing this check exists to catch.",
      ].join("\n"),
    );
  }
}

/**
 * Wait for the port to come free, or fail naming the consequence.
 *
 * A listening socket is released when its process exits, so this is a proxy for
 * "the application is gone" rather than a socket-state check — the `TIME_WAIT`
 * that lingers after the acceptance request belongs to an ephemeral client port,
 * not to this one.
 */
async function assertPortReleased(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const free = await new Promise((resolve) => {
      const probe = createServer();

      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen({ port, host: "localhost", exclusive: true });
    });

    if (free) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const holders = findPortHolders(port);

  throw new Error(
    [
      `Port ${port} is still held ${timeoutMs}ms after teardown — killTree did not reap the application process.`,
      holders.length > 0
        ? `  still listening: pid ${holders.join(", ")}   (kill with: taskkill /pid ${holders[0]} /T /F)`
        : "  nothing appears to be listening, so the port may simply be slow to release",
      "",
      "The next run would fail with EADDRINUSE against a process nothing points at.",
    ].join("\n"),
  );
}

/** Start the app and resolve once it answers, or reject with why it didn't. */
/**
 * Readiness has TWO budgets on purpose, because "does it boot and serve" and
 * "how long did that take" are different claims and only one of them should
 * ever fail a release.
 *
 * CEILING — the correctness assertion. Exceeding it means the app never served,
 * which is a genuine hang and must fail the gate.
 *
 * SOFT BUDGET — an observation. Exceeding it prints a warning and nothing more.
 * A wall-clock figure on a shared developer machine measures the machine as
 * much as the framework: this gate has failed at 64.3s against a 60s budget
 * purely because two unrelated `warlock dev` servers were running. Failing a
 * release on that teaches people to ignore the gate, and an ignored gate is
 * worse than a slow one. We cannot assert a duration until there is a stable
 * baseline to assert against.
 */
const READINESS_CEILING_MS = 180_000;

const READINESS_SOFT_BUDGET_MS = 60_000;

function startAndRequest({ command, args, readiness = "banner" } = {}) {
  const [defaultCommand, defaultArgs] = warlockCommand("start");
  const launchCommand = command ?? defaultCommand;
  const launchArgs = args ?? defaultArgs;

  return new Promise((resolve, reject) => {
    const child = spawn(launchCommand, launchArgs, {
      cwd: appDirectory,
      // The app under test. Same rule as `run()`: the environment the verdict
      // depends on is set here, not inherited from the operator.
      env: { ...process.env, ...ACCEPTANCE_ENV },
      // stdin is closed, never inherited: `pnpm approve-builds` and friends are
      // interactive, and a child waiting on a tty that will never answer blocks
      // forever without printing why.
      stdio: ["ignore", "pipe", "pipe"],
      // No shell. Both launch paths are now `node <absolute script>`, which needs
      // none, and a `cmd.exe` wrapper only adds a layer between this process and
      // the one holding the port — the exact gap that let an app survive its
      // parent being killed and take the next run down with EADDRINUSE.
      shell: false,
      // Own process group on POSIX so `killTree` can signal the whole thing.
      detached: process.platform !== "win32",
    });

    const launchedAt = Date.now();

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error, result) => {
      if (settled) {
        return;
      }

      settled = true;

      if (!error) {
        const readyMs = Date.now() - launchedAt;

        console.log(`TIME_TO_READY_MS=${readyMs}`);

        if (readyMs > READINESS_SOFT_BUDGET_MS) {
          console.warn(
            `WARN  readiness took ${readyMs}ms, over the ${READINESS_SOFT_BUDGET_MS}ms soft budget. ` +
              `Recorded, not failed — check what else is running before reading it as a regression.`,
          );
        }
      }

      // Settle only once the kill has actually run, so the teardown assertion
      // downstream is not racing it.
      void killTree(child.pid).then(() => {
        if (error) {
          reject(error);

          return;
        }

        resolve(result);
      });
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);

      // The started banner is the contract: it appears on stdout only after the
      // app reported a completed boot, so it is safe to request the endpoint.
      //
      // ONLY `warlock start` prints it — it comes from the supervisor
      // (`production-supervisor.ts`), not from the app. A bundle executed
      // directly never emits it, so that path polls the port instead; waiting
      // for the banner there would hang for the full timeout and look like a
      // boot failure.
      if (readiness === "banner" && stdout.includes("production server started")) {
        void requestAcceptanceEndpoint()
          .then((body) => finish(undefined, { stdout, stderr, body, pid: child.pid }))
          .catch((error) => finish(error));
      }
    });

    if (readiness === "poll") {
      // Poll the endpoint itself rather than any log line. Stronger than the
      // banner — it proves the app is SERVING, where the banner proves only
      // that it said so — and it is the only signal available without a
      // supervisor.
      const deadline = Date.now() + READINESS_CEILING_MS;

      const poll = () => {
        if (settled) return;

        requestAcceptanceEndpoint()
          .then((body) => finish(undefined, { stdout, stderr, body, pid: child.pid }))
          .catch(() => {
            if (Date.now() > deadline) {
              finish(
                new Error(
                  `\`${[command, ...args].join(" ")}\` never served within ${READINESS_CEILING_MS}ms`,
                ),
              );

              return;
            }

            setTimeout(poll, 500).unref();
          });
      };

      setTimeout(poll, 500).unref();
    }

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    // The command is named in both messages because this now launches the app
    // two ways — through `warlock start` and directly as a single bundle — and
    // "it exited before serving" is useless if you cannot tell which one did.
    const launched = [launchCommand, ...launchArgs].join(" ");

    child.on("exit", (code) => {
      finish(
        new Error(`\`${launched}\` exited with ${code} before serving. It never became ready.`),
      );
    });

    setTimeout(() => {
      finish(
        new Error(`\`${launched}\` never reported readiness within ${READINESS_CEILING_MS}ms`),
      );
    }, READINESS_CEILING_MS).unref();
  });
}

/**
 * Assert every `@warlock.js/*` pin in the built manifests matches the version
 * being vendored.
 *
 * The `pnpm.overrides` that make this run possible also blind it: they redirect
 * every `@warlock.js/*` to a local tarball regardless of what the manifest
 * asked for. If a built `package.json` pinned `@warlock.js/fs@4.10.0` while the
 * code needed 4.11.0, the override would hand it 4.11.0 anyway and the run
 * would pass — masking exactly the version skew lockstep exists to prevent.
 *
 * The overrides prove the CODE works. This proves the MANIFEST is right.
 */
function assertFamilyPinsMatch(version) {
  const scopeDirectory = path.dirname(coreBuildsDirectory);
  const mismatches = [];

  for (const name of readdirSync(scopeDirectory)) {
    const manifestPath = path.join(scopeDirectory, name, version, "package.json");

    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const ranges = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    };

    for (const [dependency, range] of Object.entries(ranges)) {
      if (!dependency.startsWith("@warlock.js/") || range === version) {
        continue;
      }

      mismatches.push(`@warlock.js/${name} pins ${dependency}@${range}, expected ${version}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      [
        `Lockstep violation — ${mismatches.length} pin(s) disagree with the vendored version:`,
        ...mismatches.map((mismatch) => `  ${mismatch}`),
        "",
        "The pnpm overrides would have silently supplied the right version and hidden this.",
      ].join("\n"),
    );
  }

  console.log(`  every @warlock.js/* pin agrees on ${version}`);
}

/**
 * Refuse to accept an install that is a link back into the monorepo.
 *
 * This is the assumption the whole run rests on. If pnpm linked
 * `@warlock.js/core` instead of extracting it, the strict layout disappears,
 * core's own dependencies become reachable from the app by accident, and the
 * acceptance passes for exactly the wrong reason — reporting green on the
 * defect it exists to catch.
 */
function assertFrameworkIsReallyInstalled() {
  const installed = path.join(appDirectory, "node_modules", "@warlock.js", "core");

  if (!existsSync(installed)) {
    throw new Error(`@warlock.js/core is not installed at ${installed}`);
  }

  const realPath = realpathSync(installed);

  if (!realPath.includes(`${path.sep}.pnpm${path.sep}`)) {
    throw new Error(
      [
        `@warlock.js/core resolved to ${realPath}, outside pnpm's store.`,
        "That means it was linked, not installed, so this app is NOT running under a strict layout",
        "and the acceptance would pass for the wrong reason. Install from the packed tarball.",
      ].join("\n"),
    );
  }

  // The defect in one line: the app must NOT be able to resolve core's own
  // dependency. If it can, hoisting is in play and the test proves nothing.
  const hoisted = path.join(appDirectory, "node_modules", "@mongez", "config");

  if (existsSync(hoisted)) {
    throw new Error(
      `@mongez/config is reachable at ${hoisted}. The layout is hoisted, not strict — this run cannot detect the defect.`,
    );
  }

  return realPath;
}

async function requestAcceptanceEndpoint() {
  const response = await fetch(acceptanceUrl);

  if (!response.ok) {
    throw new Error(`${acceptanceUrl} responded ${response.status}`);
  }

  return response.text();
}

/**
 * Assert the app answered from PRODUCTION mode.
 *
 * Setting `NODE_ENV` on the spawn is not evidence it arrived: a wrapper can
 * drop it, a shell can override it, and a future refactor can move the spawn
 * out from under `ACCEPTANCE_ENV` without anything failing. This reads the
 * value back out of the process that served the request, so the claim comes
 * from the app rather than from the runner's intentions.
 *
 * @param body raw response text from `/acceptance`
 */
function assertBootedInProduction(body) {
  let payload;

  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(
      `/acceptance did not return JSON, so the booted environment could not be read. Body: ${body}`,
    );
  }

  if (payload.environment !== "production") {
    throw new Error(
      [
        `The app served the request from "${payload.environment}", not "production".`,
        "",
        "This gate exists to exercise the PRODUCTION bundle. Running it in any other",
        "mode does not fail — it passes while testing something else, which is worse.",
        "",
        `Expected NODE_ENV=production to reach the app (ACCEPTANCE_ENV), got "${payload.environment}".`,
      ].join("\n"),
    );
  }

  console.log(`  app booted in ${payload.environment} — asserted, not assumed`);
}

/** The line the fixed generator emits into the app's config loader. */
const GENERATED_IMPORT = 'import { setConfig, configSpecialHandlers } from "@warlock.js/core";';

/** The defect as it shipped: core's own dependency, emitted bare. */
const REINTRODUCED_IMPORT = `import config from "@mongez/config";\n${GENERATED_IMPORT}`;

/**
 * Render a string as it appears *inside a JS string literal* in source.
 *
 * The generator holds the line it emits as a quoted literal, so the bytes on
 * disk are escaped — `\"` for each quote, `\n` for the newline. Matching the
 * unescaped text finds nothing, silently, which would turn this whole check
 * into a no-op that always reports the guard missing.
 */
const asLiteral = (source) => JSON.stringify(source).slice(1, -1);

/**
 * Reintroduce the exact defect **in the generator** and require the build to
 * refuse it.
 *
 * It has to be patched into the installed framework, not into app source. The
 * assertion covers code the BUILDER writes into `.warlock/production/`; an app
 * importing an undeclared package from its own `src/` is a different rule with
 * a different owner, and planting it there tests the assertion's neighbour
 * rather than the assertion. An earlier version of this function did exactly
 * that and reported the correct scope as a failure.
 *
 * Without this half the guard could be silently broken — or deleted — and the
 * positive case would still pass.
 */
async function assertUndeclaredImportFailsTheBuild() {
  const builderPath = path.join(
    realpathSync(path.join(appDirectory, "node_modules", "@warlock.js", "core")),
    "esm",
    "production",
    "production-builder.mjs",
  );

  const original = readFileSync(builderPath, "utf-8");
  const needle = asLiteral(GENERATED_IMPORT);

  if (!original.includes(needle)) {
    throw new Error(
      `Could not find the generated import line in ${builderPath}. The generator changed — update GENERATED_IMPORT so this half keeps testing the guard rather than silently passing.`,
    );
  }

  writeFileSync(builderPath, original.replace(needle, asLiteral(REINTRODUCED_IMPORT)));

  try {
    const { code, output } = await run(...warlockCommand("build"), {
      cwd: appDirectory,
      shell: false,
      capture: true,
      allowFailure: true,
    });

    if (code === 0) {
      throw new Error(
        "warlock build SUCCEEDED with an undeclared @mongez/config import in generated code. The assertion is not running.",
      );
    }

    if (!output.includes("@mongez/config")) {
      throw new Error("The build failed, but its output never named the offending package.");
    }

    return output;
  } finally {
    writeFileSync(builderPath, original);
  }
}

/**
 * Refuse to reuse an artifact that source has moved past.
 *
 * The reuse flag's whole hazard is that the thing under test stops being the
 * thing you changed, silently — the run stays green and proves the previous
 * state of the world. Comparing the newest source mtime against the artifact's
 * turns that from invisible into a refusal.
 *
 * Deliberately compares against `core/src` only. A stale sibling is possible in
 * principle, but core is what this fixture exercises and a check nobody can
 * satisfy gets disabled rather than obeyed.
 */
function assertArtifactIsNotStale(version) {
  const artifactPath = path.join(coreBuildsDirectory, version, "package.json");
  const artifactBuiltAt = statSync(artifactPath).mtimeMs;
  const sourceDirectory = path.join(coreDirectory, "src");

  let newestSource = 0;
  let newestSourceFile = "";

  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);

        continue;
      }

      const { mtimeMs } = statSync(entryPath);

      if (mtimeMs > newestSource) {
        newestSource = mtimeMs;
        newestSourceFile = entryPath;
      }
    }
  };

  walk(sourceDirectory);

  if (newestSource > artifactBuiltAt) {
    throw new Error(
      [
        `The artifact at ${version} predates core's source and cannot prove anything about it.`,
        `  artifact built: ${new Date(artifactBuiltAt).toISOString()}`,
        `  newest source:  ${new Date(newestSource).toISOString()} (${path.relative(coreDirectory, newestSourceFile)})`,
        "",
        "Drop the reuse flag and let the run build the family.",
      ].join("\n"),
    );
  }
}

/**
 * Build the fixture with `singleBundle: true` and RUN the result.
 *
 * The defect this covers is specifically a build that SUCCEEDS and a process
 * that then dies: a consumer set `packages: "bundle"`, got a clean build, and
 * hit `Dynamic require of "node:assert" is not supported` at runtime. So a
 * green `warlock build` proves nothing here — the bundle has to be executed.
 *
 * It is executed with `node dist/app.js` directly rather than through
 * `warlock start`, because the point of a single bundle is that it runs
 * WITHOUT the framework's launcher. Booting it through `start` would test the
 * launcher and leave the actual claim unverified.
 *
 * A successful boot is proven by the app answering on its port, not by the
 * process staying alive — a process can survive while failing to serve.
 */
async function assertSingleBundleRuns() {
  const configPath = path.join(appDirectory, "warlock.config.ts");
  const originalConfig = readFileSync(configPath, "utf-8");

  if (!originalConfig.includes("build:")) {
    throw new Error(
      `${configPath} has no \`build\` block, so this check cannot enable singleBundle. ` +
        `The fixture changed shape — fix this assertion rather than skipping it.`,
    );
  }

  const outputDirectory = path.join(appDirectory, "dist");

  try {
    writeFileSync(
      configPath,
      originalConfig.replace(/build:\s*\{/, "build: {\n    singleBundle: true,"),
    );

    // Emptied first, and this is load-bearing rather than tidiness. `warlock
    // build` does NOT clean its output directory, and the positive case above
    // already ran a DEFAULT build that left its `routes-*.js` chunks here. A
    // count taken over a dirty directory therefore fails a correct build: this
    // check was written that way and would have reported "emitted 4, expected
    // exactly one" against a bundle that was in fact single. Worse, it can also
    // pass wrongly — a stale `app.js` from an earlier build satisfies the
    // existence check when the new build produced nothing at all.
    rmSync(outputDirectory, { recursive: true, force: true });

    await run(...warlockCommand("build"), { cwd: appDirectory, shell: false });

    const bundlePath = path.join(outputDirectory, "app.js");

    if (!existsSync(bundlePath)) {
      throw new Error(`singleBundle build produced no ${bundlePath}`);
    }

    // No chunk files beside it — that is what "single" means, and a build
    // that quietly kept splitting on would still boot, so nothing else
    // would notice.
    const emitted = readdirSync(outputDirectory).filter((file) => file.endsWith(".js"));

    if (emitted.length !== 1) {
      throw new Error(
        `singleBundle emitted ${emitted.length} .js files (${emitted.join(", ")}), expected exactly one.`,
      );
    }

    const { body, pid } = await startAndRequest({
      command: process.execPath,
      args: [bundlePath],
      // No supervisor here, so no started banner — poll the endpoint.
      readiness: "poll",
    });

    console.log(`  response: ${body}`);
    assertBootedInProduction(body);
    console.log(`  ran with \`node dist/app.js\` — no launcher, no chunks`);

    await assertTeardownComplete(pid, acceptancePort);
  } finally {
    // Always restore: a fixture left with singleBundle on would silently
    // change what every later run is testing.
    writeFileSync(configPath, originalConfig);
  }
}

async function main() {
  if (skipFrameworkBuild) {
    console.error("");
    console.error("  ! REUSING AN EXISTING ARTIFACT — this run does not gate a release.");
    console.error("    The framework is not rebuilt, so it tests whatever was built last.");
    console.error("");
  }

  if (!skipFrameworkBuild) {
    log(`Building the framework at ${targetVersion} (no publish, no git)`);
    await run(
      "npx",
      [
        "pkgist",
        "build:family",
        "warlock",
        "--no-publish",
        "--no-git",
        "--bump",
        targetVersion,
      ],
      { cwd: builderDirectory },
    );
  }

  if (skipFrameworkBuild) {
    log("Checking the reused artifact is not older than core's source");
    assertArtifactIsNotStale(latestCoreVersion());
    console.log("  artifact is newer than every file in core/src");
  }

  const version = await packFramework();

  log("Verifying the lockstep pins the overrides would otherwise mask");
  assertFamilyPinsMatch(version);

  log("Installing with pnpm (strict layout, no hoisting)");
  rmSync(path.join(appDirectory, "node_modules"), { recursive: true, force: true });
  // The INSTALL is deliberately not run in production mode.
  //
  // Package managers read NODE_ENV: under `production` both yarn 1 and pnpm
  // skip devDependencies entirely — silently, exit 0, no warning. Installing
  // the app under `production` would therefore resolve a different tree than a
  // developer gets, and the gate would build against dependencies nobody has.
  //
  // The fixture happens to declare no devDependencies today, so nothing is
  // dropped; that is luck, not a guarantee, and the first devDependency added
  // to it would break this quietly. Everything AFTER the install — the build
  // and the boot, which are what the gate is actually about — still runs in
  // production, and the app reports back which mode it booted in.
  await run("npx", ["pnpm", "install", "--no-frozen-lockfile"], {
    cwd: appDirectory,
    env: { NODE_ENV: "development" },
  });

  log("Verifying the layout is strict and the framework is really installed");
  console.log(`  @warlock.js/core → ${assertFrameworkIsReallyInstalled()}`);

  log("POSITIVE — building the app");
  await run(...warlockCommand("build"), { cwd: appDirectory, shell: false });

  log("POSITIVE — starting the app and requesting /acceptance");
  const { body, pid } = await startAndRequest();
  console.log(`  response: ${body}`);
  assertBootedInProduction(body);

  log("Verifying teardown reaped the process and released the port");
  await assertTeardownComplete(pid, acceptancePort);
  console.log(`  port ${acceptancePort} released; wrapper ${pid} gone (wrapper check is narrow — see assertTeardownComplete)`);

  if (baselineOnly) {
    log("NEGATIVE — an undeclared import must fail the build");
    await assertUndeclaredImportFailsTheBuild();

    log(
      `BASELINE ACCEPTED @warlock.js/core@${version} — built, booted, served, and refused an undeclared import. The singleBundle case was SKIPPED; this run does not gate that feature.`,
    );

    return;
  }

  log("SINGLE BUNDLE — one self-contained file must build AND run");
  await assertSingleBundleRuns();

  log("NEGATIVE — an undeclared import must fail the build");
  await assertUndeclaredImportFailsTheBuild();

  log(
    `ACCEPTED @warlock.js/core@${version} — built, booted, served, produced a runnable single bundle, and refused an undeclared import.`,
  );
}

main().catch((error) => {
  console.error(`\n✖ ACCEPTANCE FAILED: ${error.message}`);
  process.exit(1);
});
