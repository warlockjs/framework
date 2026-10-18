import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSync, type Node, type ObjectExpression } from "oxc-parser";

export type IssueConfigSummary = {
  status: "missing" | "unreadable" | "unparsed" | "static";
  sections: string[];
  buildFlags: Record<string, boolean>;
  connectors: number | null;
  customCommands: number | null;
  dynamic: boolean;
};

export type IssueEnvironment = {
  packages: Record<string, string>;
  node: string;
  packageManager: { name: string; version: string | null } | null;
  os: { platform: string; release: string; arch: string };
  typescript: string | null;
  config: IssueConfigSummary;
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

// Version metadata only: never copy arbitrary manifest strings into a public report.
function versionOf(value: unknown): string | null {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(value) ? value : null;
}

function moduleDirectories(cwd: string): string[] {
  const directories: string[] = [];
  for (let current = path.resolve(cwd); ; current = path.dirname(current)) {
    directories.push(path.join(current, "node_modules"));
    if (path.dirname(current) === current) return directories;
  }
}

function installedVersion(directories: string[], name: string): string | null {
  for (const directory of directories) {
    const file = path.join(directory, name, "package.json");
    if (existsSync(file)) return versionOf(field(readJson(file), "version"));
  }
  return null;
}

function installedPackages(directories: string[]): Record<string, string> {
  const names = new Set<string>();
  for (const directory of directories) {
    try {
      for (const name of readdirSync(path.join(directory, "@warlock.js"))) {
        if (/^[a-z0-9][a-z0-9-]*$/.test(name)) names.add(`@warlock.js/${name}`);
      }
    } catch {
      // Missing node_modules is useful information, not a reason to require a boot.
    }
  }
  const packages: Record<string, string> = {};
  for (const name of [...names].sort()) {
    const version = installedVersion(directories, name);
    if (version) packages[name] = version;
  }
  return packages;
}

function packageManager(
  cwd: string,
  userAgent: string | undefined,
): IssueEnvironment["packageManager"] {
  const agent = /^(npm|pnpm|yarn|bun)\/(\d+\.\d+\.\d+(?:[-+][\w.+-]+)?)(?:\s|$)/.exec(
    userAgent ?? "",
  );
  if (agent?.[1] && agent[2]) return { name: agent[1], version: agent[2] };

  const declared = field(readJson(path.join(cwd, "package.json")), "packageManager");
  const name =
    typeof declared === "string" ? /^(npm|pnpm|yarn|bun)@/.exec(declared)?.[1] : undefined;
  const detected =
    name ??
    (
      [
        ["pnpm-lock.yaml", "pnpm"],
        ["yarn.lock", "yarn"],
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"],
        ["package-lock.json", "npm"],
      ] as const
    ).find(([file]) => existsSync(path.join(cwd, file)))?.[1];
  if (!detected) return null;

  // Only a known executable and --version, never app scripts or npm_execpath.
  // Probe outside the app so manager shims cannot select/install an app-pinned
  // version or load project plugins. The result records our child's PID;
  // timeout targets only that child.
  const child = spawnSync(detected, ["--version"], {
    cwd: path.parse(path.resolve(cwd)).root,
    encoding: "utf8",
    timeout: 3_000,
    maxBuffer: 4_096,
    env: { ...process.env, COREPACK_ENABLE_NETWORK: "0", COREPACK_ENABLE_AUTO_PIN: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return { name: detected, version: child.status === 0 ? versionOf(child.stdout.trim()) : null };
}

function unwrap(node: Node): Node {
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "ParenthesizedExpression" ||
    node.type === "TSTypeAssertion"
  )
    return unwrap(node.expression);
  return node;
}

function property(object: ObjectExpression, name: string): Node | undefined {
  for (const item of [...object.properties].reverse()) {
    if (item.type !== "Property" || item.computed || item.method) continue;
    const key =
      item.key.type === "Identifier"
        ? item.key.name
        : item.key.type === "Literal"
          ? item.key.value
          : undefined;
    if (key === name) return unwrap(item.value);
  }
  return undefined;
}

/** Parse syntax only; never import config, .env, connectors or app modules. */
export function collectIssueConfig(cwd: string): IssueConfigSummary {
  const summary: IssueConfigSummary = {
    status: "missing",
    sections: [],
    buildFlags: {},
    connectors: null,
    customCommands: null,
    dynamic: false,
  };
  const file = path.join(cwd, "warlock.config.ts");
  if (!existsSync(file)) return summary;
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return { ...summary, status: "unreadable" };
  }
  try {
    const parsed = parseSync("warlock.config.ts", source);
    if (parsed.errors.length) return { ...summary, status: "unparsed", dynamic: true };
    const exported = parsed.program.body.find((node) => node.type === "ExportDefaultDeclaration");
    let value: Node | undefined = exported ? unwrap(exported.declaration) : undefined;
    if (
      value?.type === "CallExpression" &&
      value.callee.type === "Identifier" &&
      value.callee.name === "defineConfig"
    ) {
      value = value.arguments[0];
    }
    if (value) value = unwrap(value);
    if (value?.type !== "ObjectExpression")
      return { ...summary, status: "unparsed", dynamic: true };

    const object = value;
    summary.status = "static";
    // Fixed allowlist excludes custom keys, paths, names and all string values.
    summary.sections = [
      "server",
      "build",
      "connectors",
      "cli",
      "devServer",
      "database",
      "testing",
    ].filter((name) => property(object, name) !== undefined);
    summary.dynamic = object.properties.some(
      (item) => item.type === "SpreadElement" || item.computed,
    );
    const build = property(object, "build");
    if (build?.type === "ObjectExpression") {
      for (const key of ["minify", "sourcemap", "singleBundle", "esmShim", "splitting"]) {
        const flag = property(build, key);
        if (flag?.type === "Literal" && typeof flag.value === "boolean")
          summary.buildFlags[key] = flag.value;
      }
    }
    const connectors = property(object, "connectors");
    if (
      connectors?.type === "ArrayExpression" &&
      !connectors.elements.some((item) => item?.type === "SpreadElement")
    ) {
      summary.connectors = connectors.elements.length;
    }
    const cli = property(object, "cli");
    const commands = cli?.type === "ObjectExpression" ? property(cli, "commands") : undefined;
    if (
      commands?.type === "ArrayExpression" &&
      !commands.elements.some((item) => item?.type === "SpreadElement")
    ) {
      summary.customCommands = commands.elements.length;
    }
    return summary;
  } catch {
    return { ...summary, status: "unparsed", dynamic: true };
  }
}

/** Collect installed metadata without starting the app or reading private values. */
export function collectIssueEnvironment(
  cwd = process.cwd(),
  userAgent = process.env.npm_config_user_agent,
): IssueEnvironment {
  const directories = moduleDirectories(cwd);
  return {
    packages: installedPackages(directories),
    node: process.version,
    packageManager: packageManager(cwd, userAgent),
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    typescript: installedVersion(directories, "typescript"),
    config: collectIssueConfig(cwd),
  };
}
