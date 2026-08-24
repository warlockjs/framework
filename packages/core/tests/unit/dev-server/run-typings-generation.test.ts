import { describe, expect, it, vi } from "vitest";
import type { TypingsGenerationPorts } from "../../../src/dev-server/run-typings-generation";
import { runTypingsGeneration } from "../../../src/dev-server/run-typings-generation";

/*
  The defect this file closes. `type-generator.ts` ran type generation by
  spawning `npx warlock generate.typings`, which resolves to
  `core/bin/warlock.js` → `import "../esm/cli/start.mjs"`. This monorepo
  consumes packages as TypeScript SOURCE (canon 0a3227cc), so there is no
  `esm/` — every dev boot printed `✗ Failed to generate types`, and an
  ERR_MODULE_NOT_FOUND stack rode along inside a green core suite.

  Two things made it hard to see. The failure message named no cause, so the
  log said something failed without saying what. And spawning at all was the
  real mistake: `generateAll()` lives in this very process, and the dev server
  has already initialised the file orchestrator the CLI would have rebuilt.

  Launching a binary through npx is also a standing prohibition here
  (canon 50608334) — resolve and invoke directly.
*/

function harness(generate: () => Promise<void> = async () => undefined) {
  const messages: { level: "info" | "success" | "error"; text: string }[] = [];

  const ports: TypingsGenerationPorts = {
    generate: vi.fn(generate),
    info: text => messages.push({ level: "info", text }),
    success: text => messages.push({ level: "success", text }),
    error: text => messages.push({ level: "error", text }),
  };

  return { ports, messages, at: (level: string) => messages.filter(m => m.level === level) };
}

describe("runTypingsGeneration — the happy path", () => {
  it("calls the IN-PROCESS generator", async () => {
    const { ports } = harness();

    await runTypingsGeneration(ports);

    expect(ports.generate).toHaveBeenCalledTimes(1);
  });

  it("reports success and never reports an error", async () => {
    const { ports, at } = harness();

    await runTypingsGeneration(ports);

    expect(at("success")).toHaveLength(1);
    expect(at("error")).toHaveLength(0);
  });
});

describe("runTypingsGeneration — when generation fails", () => {
  const boom = new Error("ENOENT: typings directory is read-only");

  it("names the cause instead of only saying it failed", async () => {
    const { ports, at } = harness(async () => {
      throw boom;
    });

    await runTypingsGeneration(ports);

    // "Failed to generate types" on its own sends the reader hunting. The
    // reason is the whole value of the line.
    expect(at("error")[0]?.text).toContain("read-only");
  });

  it("does NOT throw — type generation is a convenience, not a boot gate", async () => {
    const { ports } = harness(async () => {
      throw boom;
    });

    await expect(runTypingsGeneration(ports)).resolves.toBeUndefined();
  });

  it("does not also claim success", async () => {
    const { ports, at } = harness(async () => {
      throw boom;
    });

    await runTypingsGeneration(ports);

    expect(at("success")).toHaveLength(0);
  });

  it("survives a thrown non-Error", async () => {
    const { ports, at } = harness(async () => {
      throw "just a string";
    });

    await expect(runTypingsGeneration(ports)).resolves.toBeUndefined();
    expect(at("error")[0]?.text).toContain("just a string");
  });
});
