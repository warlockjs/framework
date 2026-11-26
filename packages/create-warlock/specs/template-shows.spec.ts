import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function path(relative: string): string {
  return fileURLToPath(new URL(`../templates/warlock/${relative}`, import.meta.url));
}

const read = (relative: string): string => readFileSync(path(relative), "utf8");

/** The criterion ids written in a flow file's `## Acceptance criteria`. */
function criteriaOf(flowFile: string): string[] {
  return [...read(flowFile).matchAll(/^\s*[-*]\s+(AC-\d+)\b/gm)].map((match) => match[1] ?? "");
}

const SHOWN: Record<string, string[]> = {
  "contact/send-message": ["AC-1", "AC-2", "AC-3", "AC-4"],
  "design-system/direction": ["AC-1", "AC-2"],
  "design-system/components": ["AC-1"],
  "design-system/error-messages": ["AC-1"],
};

describe("starter template: @shows scenes", () => {
  const scenes = read("e2e/shows.e2e.ts");

  for (const [ref, criteria] of Object.entries(SHOWN)) {
    for (const criterion of criteria) {
      it(`shows ${ref} ${criterion} with a comment directly above its call`, () => {
        expect(scenes).toContain(
          `// @shows ${ref} ${criterion}\n    await shows(context, "${ref} ${criterion}"`,
        );
      });
    }
  }

  it("covers every criterion the written flows have", () => {
    for (const ref of Object.keys(SHOWN)) {
      const [feature, flow] = ref.split("/");
      const file = `grimoire/features/${feature}/flows/${flow}.md`;

      if (!existsSync(path(file))) continue;

      expect(criteriaOf(file).filter((id) => !SHOWN[ref]?.includes(id))).toEqual([]);
    }
  });

  it("fakes the failed server in the failure scenes", () => {
    expect(scenes).toContain('fail: "unreachable"');
    expect(scenes).toContain("status: 500");
  });
});

describe("starter template: components page", () => {
  it("answers not found outside development", () => {
    const setup = read("src/web/dev/components.setup.ts");

    expect(setup).toContain('environment() !== "development"');
    expect(setup).toContain('process.env.WARLOCK_E2E !== "1"');
    expect(setup).toContain("response.notFound()");
    expect(setup).toContain('path: "/dev/components"');
  });

  it("is the page every design-system scene drives", () => {
    const scenes = read("e2e/shows.e2e.ts");

    expect(scenes).toContain('path("/dev/components")');
    expect(scenes).not.toContain('#contact"');
  });

  it("falls back to the memory cache in an end-to-end run", () => {
    const cache = read("src/config/cache.ts");

    expect(cache).toContain('env("WARLOCK_E2E") === "1"');
    expect(cache).toContain('"memory" : "redis"');
  });

  it("keeps the contact UI inside the contact feature's folders", () => {
    expect(read("grimoire/features/contact/README.md")).toContain("src/web/home/components");
  });

  it("renders form controls and headings", () => {
    const page = read("src/web/dev/components.page.tsx");

    expect(page).toContain("<h1>");
    expect(page).toContain("<input");
    expect(page).toContain("<textarea");
  });
});
