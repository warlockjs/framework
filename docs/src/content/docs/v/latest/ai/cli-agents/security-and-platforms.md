---
title: "Security and platforms"
description: "How @warlock.js/ai-cli keeps secrets out of argv, isolates config homes, fails closed with the capability probe, spawns CLIs on Windows, and cancels whole process trees."
sidebar:
  order: 3
  label: "Security and platforms"
---

## Secrets never travel in argv

Command lines are visible to every local user (`ps`, `/proc/<pid>/cmdline`, Windows process listings), so nothing secret is put there:

- **API keys** go into the environment: `apiKey` becomes the adapter's key variable, and `env` adds anything else.
- **MCP tokens** in a server's `env` or `headers` are written into a config file with mode **0600**. The file lives inside a per-run directory with mode **0700**, created with `mkdtemp` under the OS temp directory and removed when the run ends. Adapters can only write files inside that directory; a path outside it is refused.
- **Key files:** Reasonix reads provider keys only from its `.env`, and Antigravity needs a settings flag for API-key auth. Those files are written into the private home, with the same 0600 mode.
- **Codex with a shared home** gets MCP servers as `-c mcp_servers.<name>.…` overrides that carry only the command, args and URL. The secret values travel in the environment, named through `env_vars` and `env_http_headers`.

`args` is passed through verbatim, so never put a token there.

## Config homes

| `home`                | What happens                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"private"` (default) | A fresh `home/` inside the run directory: the adapter points the CLI's home variable (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `GROK_HOME`, …) at it. Nothing from your own login leaks in, nothing from the run leaks out; authenticate with `apiKey`/`env`. |
| an absolute path      | A home you own and keep, for example one you logged in to once: `CLAUDE_CONFIG_DIR=/srv/claude-home claude`, then `home: "/srv/claude-home"`. Run-scoped files still go to the private run directory, never into this home.                                             |
| `"inherit"`           | The current user's normal config. The adapter's home variables are not touched.                                                                                                                                                                                         |

Some CLIs cannot be pointed at a different config directory: Antigravity, Cursor's MCP file and Aider. For those, a private home sets `HOME` (and `USERPROFILE`) instead. OpenCode and Amp follow XDG, so their `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` are pointed into the home.

When the home is not `"inherit"`, the adapter's home variables are stripped from the inherited environment, so a value you exported for yourself cannot override the run's home. Your own `env` option still wins over everything.

Use `inheritEnv: false` to pass only a minimal system set: `PATH`, home and temp directories, locale, proxy and TLS variables, and the Windows system variables. A list of names passes those names on top of the minimal set. This keeps the API keys of other vendors in your process away from the CLI.

## Capability probe

Before the first run of a CLI agent, the runner reads the installed CLI's `--version` and help screens. Some adapters read more than one, such as `codex exec --help` and `codex exec resume --help`. Every launch plan declares the flags (and subcommands) it relies on. If one of them is not listed, the run fails before anything is spawned:

```text
CliError [capability]: Codex CLI 0.170.0 (/usr/local/bin/codex) does not support --skip-git-repo-check:
not listed in "codex exec --help, codex exec resume --help". This adapter was verified against Codex CLI
0.163.0; install a compatible version or drop the option that needs --skip-git-repo-check.
```

The error carries `type`, `flag`, `version` and `executable`. Flags are matched as whole tokens, so `--json` does not match `--json-schema`.

The probe result is cached per executable for the life of the agent; `agent.probe()` returns it. `probe: false` skips the check, but then a CLI release with changed flags fails at run time instead.

Each adapter also records where it was verified (`adapter.verification`). For CLIs checked against docs only, the probe is the guard that keeps a guessed flag from reaching a real run.

## Windows spawn rules

Node cannot spawn `.cmd`/`.bat` files without a shell (since CVE-2024-27980), and most CLIs install as npm `.cmd` shims. The runner resolves a command the way the shell would, then avoids `cmd.exe` whenever it can:

1. **`PATHEXT` lookup.** The runner walks `PATH` (read case-insensitively, so `Path` works) and tries each `PATHEXT` extension, so `claude` finds `claude.cmd`.
2. **npm and pnpm shims are unwrapped.** The runner reads the shim and finds the script it launches (`"%dp0%\node_modules\…\cli.js" %*`), then spawns `node <script>` directly. It uses the shim's bundled `node.exe` when present, otherwise the running Node. A shim around a native `.exe` runs that `.exe`. argv then reaches the CLI with no `cmd.exe` parsing in between.
3. **`cmd.exe` fallback with safe quoting.** Any other batch file runs as `cmd.exe /d /v:off /s /c ""file" "arg" …"`: AutoRun is off, delayed expansion is off, and every element is double-quoted, so `& | < > ^ !` stay literal. Trailing backslashes are doubled. An argument containing `"`, `%`, a newline or NUL is refused, because those cannot be carried safely (the BatBadBut class of injection).
4. **The prompt moves to stdin (or a prompt file) when argv cannot carry it.** That covers a prompt `cmd.exe` would refuse, and a command line over the 8191-character `cmd.exe` limit or the 32767-character `CreateProcess` limit. On POSIX the per-argument limit (128 KiB on Linux) applies.

These rules are exported as pure functions for diagnostics and tests: `findExecutable`, `parseCmdShim`, `resolveSpawnTarget`, `buildInvocation`, `quoteForCmd` and `fitsCommandLine`.

## Cancellation and timeouts

Coding CLIs start shells, language servers and MCP servers, so killing the direct child is not enough.

- **POSIX:** the CLI is spawned as its own process group. On abort or timeout the group gets `SIGTERM`, then `SIGKILL` after `killGraceMs` (default 2000), even if the leader already exited. A grandchild that ignores `SIGTERM` is still reaped.
- **Windows:** `taskkill /T /F` kills the process tree.

A run whose `signal` is already aborted never spawns. After `cancel()`, an abort or a timeout, `session.done()` resolves with `status` `cancelled` or `timeout`.

Once the CLI's pipes have closed, the run is over: `cancel()` and aborting its `signal` do nothing, and the result keeps its real status. The old process group is never signalled again, because its id may already belong to an unrelated process. Calling `session.cancel()` in a `finally` block is therefore safe.

## Exit codes and errors

The session ends `failed` on any of these:

- a non-zero exit;
- a spawn failure;
- a fatal error in the stream, even with exit 0 — for example Aider's failed model call, or a `result` with `is_error: true`.

`result.error` holds the vendor's error message, or the tail of stderr. `result.stderr` keeps the last 64 KiB.
