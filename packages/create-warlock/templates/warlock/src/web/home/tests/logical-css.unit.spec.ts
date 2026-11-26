import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every `.tsx` and `.css` file under a folder. */
function styledFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);

    if (statSync(path).isDirectory()) {
      return styledFiles(path);
    }

    return /\.(?:tsx|css)$/.test(name) ? [path] : [];
  });
}

// A line that must stay physical says why with `grimoire-allow logical-css: <reason>`.
describe("reading direction in the styles", () => {
  // @proves design-system/direction AC-1
  it("uses start and end, never left and right, for text and spacing", () => {
    const physical =
      /\b(?:text-(?:left|right)|(?:ml|mr|pl|pr)-\d|(?:float|text-align):\s*(?:left|right))\b/;
    const offenders = styledFiles("src/web").filter((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .some((line) => physical.test(line) && !line.includes("grimoire-allow logical-css")),
    );

    expect(offenders).toEqual([]);
  });
});
