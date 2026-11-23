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
    expect(setup).toContain("response.notFound()");
    expect(setup).toContain('path: "/dev/components"');
  });

  it("renders form controls and headings", () => {
    const page = read("src/web/dev/components.page.tsx");

    expect(page).toContain("<h1>");
    expect(page).toContain("<input");
    expect(page).toContain("<textarea");
  });
});
