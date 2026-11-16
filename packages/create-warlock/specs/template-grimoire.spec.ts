import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { features } from "../src/features/features-map";
import { spinnerMessages } from "../src/ui/spinners";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

describe("starter template: Grimoire", () => {
  it("registers the commands from the warlock entry", () => {
    const config = read("../templates/warlock/warlock.config.ts");

    expect(config).toContain('from "@warlock.js/grimoire/warlock"');
    expect(config).toContain("registerGrimoireCommands()");
  });

  it("depends on the grimoire package with the scaffolder placeholder version", () => {
    const manifest = JSON.parse(read("../templates/warlock/package.json"));

    expect(manifest.dependencies["@warlock.js/grimoire"]).toBe("0.0.0-set-by-scaffolder");
  });

  it("ignores exactly the files the package says are generated", () => {
    const source = read("../../grimoire/src/paths/index.ts");
    const block = /GRIMOIRE_IGNORE_RULES = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
    const rules = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const ignore = read("../templates/warlock/_.gitignore").split(/\r?\n/);

    expect(rules.length).toBeGreaterThan(0);

    for (const rule of rules) {
      expect(ignore).toContain(rule);
    }
  });

  it("mounts the devtools tab and points agents to the skill", () => {
    expect(read("../templates/warlock/src/config/devtools.ts")).toContain(
      '"@warlock.js/grimoire/devtools"',
    );
    expect(read("../templates/warlock/AGENTS.md")).toContain("use-the-grimoire");
  });

  it("is offered as a feature and the git spinner no longer says grimoire", () => {
    expect(features.map((feature) => feature.key)).toContain("grimoire");
    expect(spinnerMessages.initializingGit).toBe("Initializing git repository...");
    expect(spinnerMessages.gitInitialized).toBe("Git repository initialized!");
  });
});
