import { describe, expect, it } from "vitest";
import {
  ConnectorLifecyclePhase,
  type Connector,
  type ConnectorBuildContext,
  type ConnectorBuildContribution,
} from "../../../src/connectors/types";
import {
  assertClosedContribution,
  mergeEsbuildPatches,
  runEmitContributions,
  runGenerateContributions,
} from "../../../src/production/build-contributions";
import type { ResolvedBuildConfig } from "../../../src/production/resolve-build-config";

/**
 * B1 — the build-contribution drain (canon `742c4836` §3).
 *
 * The drain copies `Application.runStartupValidators` semantics: array order,
 * sequential await, and a throw becomes a build failure that NAMES the
 * connector responsible. The closed-type constraint (canon `68876e58` B) is
 * asserted at read time, so a config that dodged the type still fails loudly.
 */

const context: ConnectorBuildContext = {
  productionDir: "/app/.warlock/production",
  appRoot: "/app",
  options: {} as ResolvedBuildConfig,
};

/** A connector that exists only to carry a `build` contribution. */
function connector(name: string, build?: ConnectorBuildContribution): Connector {
  return {
    name,
    priority: 0,
    lifecyclePhase: ConnectorLifecyclePhase.Early,
    build,
    isActive: () => false,
    boot: () => undefined,
    start: async () => undefined,
    restart: async () => undefined,
    shutdown: async () => undefined,
    shouldRestart: () => false,
  };
}

describe("runGenerateContributions — order and failure naming", () => {
  it("runs hooks in connectors-array order, one at a time", async () => {
    const calls: string[] = [];

    const slow = connector("slow", {
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        calls.push("slow");
      },
    });

    const fast = connector("fast", {
      generate() {
        calls.push("fast");
      },
    });

    await runGenerateContributions([slow, fast], context);

    expect(calls).toEqual(["slow", "fast"]);
  });

  it("collects entryImports in contributor order", async () => {
    const web = connector("web", {
      generate: () => ({ entryImports: ['await import("./pages");'] }),
    });
    const docs = connector("docs", {
      generate: () => ({ entryImports: ['await import("./docs");'] }),
    });

    const { entryImports } = await runGenerateContributions([web, docs], context);

    expect(entryImports).toEqual(['await import("./pages");', 'await import("./docs");']);
  });

  it("fails the build with an error naming the connector and the hook", async () => {
    const broken = connector("web", {
      generate() {
        throw new Error("vite manifest missing");
      },
    });

    const error = await runGenerateContributions([broken], context).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Build contribution "web" failed during generate');
    expect((error as Error).message).toContain("vite manifest missing");
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("names the emit hook when emit is what failed", async () => {
    const broken = connector("web", {
      emit() {
        throw new Error("client build failed");
      },
    });

    const error = await runEmitContributions([broken], context).catch((e: Error) => e);

    expect((error as Error).message).toContain('Build contribution "web" failed during emit');
  });

  it("stops at the first failure — a later contributor never runs", async () => {
    let ran = false;

    const broken = connector("web", {
      generate() {
        throw new Error("boom");
      },
    });
    const later = connector("docs", {
      generate() {
        ran = true;
      },
    });

    await runGenerateContributions([broken, later], context).catch(() => undefined);

    expect(ran).toBe(false);
  });

  it("skips connectors with no build contribution", async () => {
    await expect(runGenerateContributions([connector("database")], context)).resolves.toEqual({
      entryImports: [],
      esbuild: {},
    });
  });
});

describe("assertClosedContribution — unknown keys are rejected, not ignored", () => {
  it("rejects a data-bearing key on the contribution object", () => {
    // The type forbids this; a plain `warlock.config.js` or an `as any` does
    // not. This is the runtime half of the same constraint.
    const smuggler = connector("web", {
      generate: () => undefined,
      plugins: ["warlockClientBoundary"],
    } as unknown as ConnectorBuildContribution);

    expect(() => assertClosedContribution(smuggler)).toThrowError(/"web".*"plugins"/s);
  });

  it("rejects during the drain, before the hook runs", async () => {
    let ran = false;

    const smuggler = connector("web", {
      generate() {
        ran = true;
      },
      alias: {},
    } as unknown as ConnectorBuildContribution);

    await expect(runGenerateContributions([smuggler], context)).rejects.toThrowError(/"alias"/);
    expect(ran).toBe(false);
  });

  it("accepts a contribution carrying only generate and emit", () => {
    const web = connector("web", { generate: () => undefined, emit: () => undefined });

    expect(() => assertClosedContribution(web)).not.toThrow();
  });
});

describe("mergeEsbuildPatches — across contributors", () => {
  it("merges define per key rather than replacing the object", () => {
    const merged = mergeEsbuildPatches(
      { define: { "import.meta.env.DEV": "false", "import.meta.env.SSR": "true" } },
      { define: { "import.meta.env.SSR": "false", "import.meta.env.MODE": '"production"' } },
    );

    expect(merged.define).toEqual({
      "import.meta.env.DEV": "false",
      // later contributor wins on the shared key
      "import.meta.env.SSR": "false",
      "import.meta.env.MODE": '"production"',
    });
  });

  it("concatenates and dedupes external", () => {
    const merged = mergeEsbuildPatches({ external: ["react", "vite"] }, { external: ["vite", "react-dom"] });

    expect(merged.external).toEqual(["react", "vite", "react-dom"]);
  });

  it("lets the later patch win on scalar keys", () => {
    const merged = mergeEsbuildPatches(
      { jsx: "transform", jsxImportSource: "preact" },
      { jsx: "automatic", jsxImportSource: "react" },
    );

    expect(merged).toMatchObject({ jsx: "automatic", jsxImportSource: "react" });
  });
});
