/**
 * Variables a CLI needs to start at all: executable lookup, home and temp
 * directories, locale, TLS/proxy settings and the Windows system set.
 * Passed through even with `inheritEnv: false`.
 */
export const MINIMAL_ENV = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "SHELL",
  "USER",
  "LOGNAME",
  "XDG_RUNTIME_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export type BuildEnvironmentInput = {
  source: Record<string, string | undefined>;
  /**
   * `true` — everything; `false` — the minimal set; `"curated"` — the minimal
   * set plus `credentials`; a list — the minimal set plus those names.
   */
  inherit: boolean | "curated" | readonly string[];
  /** The adapter's own credential variables (`apiKeyEnv`), passed by `"curated"`. */
  credentials?: readonly string[];
  /** Variables the adapter manages (config home); never inherited from `source`. */
  managed: readonly string[];
  /** Adapter plan variables (config home, …). */
  plan?: Record<string, string>;
  /** Caller variables; win over everything else. */
  user?: Record<string, string>;
  /** API key and the variable it goes to. */
  apiKey?: { name: string; value: string };
  platform: NodeJS.Platform;
};

/**
 * Build a CLI's environment. Precedence, lowest first: inherited variables
 * (minus the adapter's managed home variables), the adapter plan, the API
 * key, then the caller's `env`. Windows variable names compare
 * case-insensitively.
 */
export function buildEnvironment(input: BuildEnvironmentInput): Record<string, string> {
  const normalize = (name: string): string =>
    input.platform === "win32" ? name.toUpperCase() : name;
  const managed = new Set(input.managed.map(normalize));
  const extra =
    input.inherit === false
      ? []
      : input.inherit === "curated"
        ? (input.credentials ?? [])
        : input.inherit === true
          ? []
          : input.inherit;
  const allowed =
    input.inherit === true ? undefined : new Set([...MINIMAL_ENV, ...extra].map(normalize));

  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(input.source)) {
    if (value === undefined || managed.has(normalize(name))) {
      continue;
    }

    if (allowed !== undefined && !allowed.has(normalize(name))) {
      continue;
    }

    environment[name] = value;
  }

  const assign = (name: string, value: string): void => {
    if (input.platform === "win32") {
      for (const existing of Object.keys(environment)) {
        if (existing.toUpperCase() === name.toUpperCase()) {
          delete environment[existing];
        }
      }
    }

    environment[name] = value;
  };

  for (const [name, value] of Object.entries(input.plan ?? {})) {
    assign(name, value);
  }

  if (input.apiKey !== undefined) {
    assign(input.apiKey.name, input.apiKey.value);
  }

  for (const [name, value] of Object.entries(input.user ?? {})) {
    assign(name, value);
  }

  return environment;
}

let warnedInheritedEnvironment = false;

/**
 * One console warning per process when a CLI agent runs in production with
 * `inheritEnv` left at its default (`true`), which hands every server
 * variable — database URLs, signing keys, other providers' keys — to a
 * model-driven CLI.
 */
export function warnInheritedEnvironment(
  title: string,
  inheritEnv: boolean | "curated" | readonly string[] | undefined,
  env: Record<string, string | undefined>,
): void {
  if (warnedInheritedEnvironment || inheritEnv !== undefined || env.NODE_ENV !== "production") {
    return;
  }

  warnedInheritedEnvironment = true;
  console.warn(
    `[warlock-ai-cli] ${title} receives the whole server environment because \`inheritEnv\` is not set (default \`true\`). ` +
      'Set `inheritEnv: "curated"` to pass only the system variables and the CLI\'s own API key variable, ' +
      "or `inheritEnv: true` to keep the current behaviour and silence this warning.",
  );
}

/** Re-arm the one-time `inheritEnv` warning. For tests. */
export function resetInheritedEnvironmentWarning(): void {
  warnedInheritedEnvironment = false;
}
