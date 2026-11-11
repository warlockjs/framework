import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Application } from "../src/commands/create-new-app/types";
import { App, agentKitSkillPackages } from "../src/helpers/app";
import { removeReleaseAgeExclusion } from "../src/helpers/pnpm-build-approvals";
import { setPackageManager } from "../src/helpers/package-manager";

/**
 * Defaults every new app ships unchanged. The template is an uncompiled tree
 * whose framework imports do not resolve here, so config files are read as
 * text (the `template-integrity.spec.ts` convention) and the generator steps
 * run against a real copy of the template.
 */

const templateRoot = path.resolve(__dirname, "..", "templates", "warlock");

function read(relativePath: string): string {
  return readFileSync(path.join(templateRoot, relativePath), "utf8");
}

describe("template security and performance defaults", () => {
  it("caps one uploaded file at a few megabytes and says how to raise it", () => {
    const http = read("src/config/http.ts");
    const match = http.match(/^\s*fileUploadLimit:\s*([\d\s*_]+),/m);

    expect(match, "fileUploadLimit is set explicitly").not.toBeNull();
    const bytes = (match?.[1] ?? "")
      .split("*")
      .map((part) => Number(part.trim().replaceAll("_", "")))
      .reduce((total, part) => total * part, 1);

    expect(bytes).toBeLessThanOrEqual(50 * 1024 * 1024);
    expect(http).toMatch(/To allow larger files,\s*\/\/ raise it here/);
  });

  it("allows only the configured CORS origins", () => {
    const http = read("src/config/http.ts");

    expect(http).not.toMatch(/^\s*origin:\s*["']\*["']/m);
    expect(http).toContain('env("CORS_ORIGINS", "")');
    expect(read(".env.example")).toMatch(/^CORS_ORIGINS=$/m);
  });

  it("sets http.multipart.routes explicitly, so production boots without the unset-option warning", () => {
    expect(read("src/config/http.ts")).toMatch(/multipart:\s*\{[^}]*\broutes:\s*"all",/s);
  });

  it("turns response compression on", () => {
    expect(read("src/config/http.ts")).toMatch(/^\s*compression:\s*true,/m);
  });

  it("issues short-lived access tokens with refresh tokens, on the current config keys", () => {
    const auth = read("src/config/auth.ts");

    expect(auth).not.toMatch(/^\s*jwt:/m);
    expect(auth).not.toContain("NO_EXPIRATION");
    expect(auth).toMatch(/accessToken:\s*\{[^}]*expiresIn:\s*"1h"/);
    expect(auth).toMatch(/refreshToken:\s*\{[^}]*enabled:\s*true/);
  });

  it("stores only a digest of each token", () => {
    expect(read("src/config/auth.ts")).toMatch(/^\s*hashTokensAtRest:\s*true,/m);
  });

  it("logs one line per request in production, not every debug phase", () => {
    const log = read("src/config/log.ts");

    expect(log).toMatch(/new ConsoleLog\(\{\s*minLevel:\s*"info"\s*\}\)/);
    expect(log).toMatch(/production:\s*\{\s*channels:\s*\[productionConsoleLog\]/);
  });

  it("bounds both in-memory caches", () => {
    const cache = read("src/config/cache.ts");

    expect(cache).toMatch(/memory:\s*\{[^}]*maxSize:\s*10_000/);
    expect(cache).toMatch(/memoryExtended:\s*\{[^}]*maxSize:\s*10_000/);
  });

  it("git-ignores every env file except the example", () => {
    const lines = read("_.gitignore").split(/\r?\n/);

    expect(lines).toContain(".env");
    expect(lines).toContain(".env.*");
    expect(lines).toContain("!.env.example");
  });

  it("throttles password-reset attempts per email as well as per address", () => {
    expect(read("src/app/auth/routes.ts")).toContain(
      'tokenConsumeThrottleMiddleware({ by: ["email", "ip"] })',
    );
  });

  it("never generates codes with Math.random", () => {
    for (const file of ["src/app/auth/services/otp.service.ts", "src/app/auth/utils/otp-code.ts"]) {
      expect(read(file), file).not.toContain("Math.random");
    }
  });

  it("puts the user list and user creation behind the admin check", () => {
    const routes = read("src/app/users/routes.ts");

    expect(routes).toMatch(
      /router\.group\(\{ middleware: \[adminMiddleware\] \}, \(\) => \{\s*router\.route\("\/users"\)/,
    );
    expect(read("src/app/users/models/user/user.model.ts")).toContain(
      'role: v.enum(["user", "admin"]).default("user")',
    );
  });

  it("lets only the author (or an admin) update a post", () => {
    const controller = read("src/app/posts/controllers/update-post.controller.ts");

    expect(controller).toMatch(/post\.get\("authorId"\)\)\s*!==\s*String\(user\.id\)/);
    expect(controller).toContain("throw new ForbiddenError(");
  });
});

describe("removeReleaseAgeExclusion", () => {
  it("drops the scaffold-only exclusion and its comment, keeping build approvals", () => {
    expect(removeReleaseAgeExclusion(read("pnpm-workspace.yaml"))).toBe(
      "allowBuilds:\n  esbuild: true\n",
    );
  });

  it("keeps settings written after the exclusion", () => {
    const yaml = `${read("pnpm-workspace.yaml")}\nonlyBuiltDependencies:\n  - esbuild\n`;

    expect(removeReleaseAgeExclusion(yaml)).toBe(
      "allowBuilds:\n  esbuild: true\n\nonlyBuiltDependencies:\n  - esbuild\n",
    );
  });

  it("leaves a file without the exclusion unchanged", () => {
    const yaml = "allowBuilds:\n  esbuild: true\n";

    expect(removeReleaseAgeExclusion(yaml)).toBe(yaml);
  });
});

describe("generated app", () => {
  let workdir: string;

  function scaffold(options: Partial<Application["options"]> = {}): string {
    const appPath = path.join(workdir, "generated-app");
    const descriptor: Application = {
      appName: "generated-app",
      appType: "warlock",
      appPath,
      pkgManager: "pnpm",
      options: {
        databaseDriver: "mongodb",
        databasePort: 27017,
        features: [],
        aiProviders: [],
        useGit: false,
        useJWT: false,
        ...options,
      },
    };

    const app = new App(descriptor).use("warlock").updatePackageJson();

    if (descriptor.options.databaseDriver === "none") {
      app.removeDatabaseConfig().removeDatabaseModules();
    }

    app.configureWebStarter(descriptor.options.features.includes("web"));
    app.configureAgentKitTargets(descriptor.options.agents ?? ["claude"]);

    return appPath;
  }

  function packageJson(appPath: string) {
    return JSON.parse(readFileSync(path.join(appPath, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      agentKit?: { targets?: string[]; pick?: Record<string, unknown> };
    };
  }

  beforeEach(() => {
    setPackageManager("pnpm");
    workdir = mkdtempSync(path.join(tmpdir(), "create-warlock-defaults-"));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("syncs agent skills only from its own @warlock.js and @mongez dependencies", () => {
    const pkg = packageJson(scaffold({ features: ["web"] }));
    const pick = pkg.agentKit?.pick ?? {};

    expect(Object.keys(pick).length).toBeGreaterThan(0);
    expect(Object.keys(pick)).toEqual(agentKitSkillPackages(pkg));
    expect(pick["@warlock.js/core"]).toBe(true);
    expect(pick["@warlock.js/web"]).toBe(true);
    expect(pick["@mongez/agent-kit"]).toBe(true);
    for (const name of Object.keys(pick)) {
      expect(name).toMatch(/^@(warlock\.js|mongez)\//);
    }
    // The default target needs no entry: the template's postinstall already targets claude.
    expect(pkg.agentKit?.targets).toBeUndefined();
  });

  it("records non-default agent targets next to the allowlist", () => {
    const pkg = packageJson(scaffold({ agents: ["claude", "cursor"] }));

    expect(pkg.agentKit?.targets).toEqual(["claude", "cursor"]);
    expect(pkg.agentKit?.pick?.["@warlock.js/auth"]).toBe(true);
  });

  it("removes the release-age exclusion once the scaffold's installs are done", () => {
    const appPath = scaffold();
    const app = new App({
      appName: "generated-app",
      appType: "warlock",
      appPath,
      pkgManager: "pnpm",
      options: {
        databaseDriver: "mongodb",
        databasePort: 27017,
        features: [],
        aiProviders: [],
        useGit: false,
        useJWT: false,
      },
    });

    expect(readFileSync(path.join(appPath, "pnpm-workspace.yaml"), "utf8")).toContain(
      "minimumReleaseAgeExclude",
    );

    app.removeReleaseAgeExclusion();

    expect(readFileSync(path.join(appPath, "pnpm-workspace.yaml"), "utf8")).not.toContain(
      "minimumReleaseAgeExclude",
    );
  });

  it("drops the authentication section from a no-database README", () => {
    const appPath = scaffold({ databaseDriver: "none", databasePort: 0 });
    const readme = readFileSync(path.join(appPath, "README.md"), "utf8");

    expect(readme).not.toContain("## Authentication");
    expect(readme).toContain("## Project structure");
  });
});
