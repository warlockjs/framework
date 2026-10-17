import fg from "fast-glob";

/** The project source files a full `warlock check` lints and convention-checks. */
export async function listSourceFiles(cwd: string): Promise<string[]> {
  const files = await fg(["src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"], {
    cwd,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  return files.sort();
}

/** Test files, wherever they live (outside node_modules). */
export async function listTestFiles(cwd: string): Promise<string[]> {
  return fg(["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"], {
    cwd,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.warlock/**"],
  });
}
