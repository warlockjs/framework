import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Every non-spec source file under a folder. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) return sources(full);

    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

describe("warlock check", () => {
  it("never writes AGENTS.md: it does not reach the AGENTS.md writers", () => {
    const checkFolder = __dirname;
    const commandFolder = path.join(__dirname, "..", "..", "cli", "commands", "check");

    for (const file of [...sources(checkFolder), ...sources(commandFolder)]) {
      const text = readFileSync(file, "utf8");

      expect(text, file).not.toMatch(/agents-md|writeAgentsMd|createAgentsMdRefresher/);
    }
  });
});
