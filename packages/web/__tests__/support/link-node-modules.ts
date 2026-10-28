import fs from "node:fs";
import path from "node:path";

/**
 * Make `destination` a node_modules folder that resolves like `source`.
 *
 * Linking the whole folder works on Linux and macOS, but a pnpm folder holds relative links, and
 * Windows resolves a relative link against the path it was reached through (the junction), not
 * against the folder that really holds it, so every package looks missing. Each entry gets its own
 * junction to its real location instead.
 */
export function linkNodeModules(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });

  const link = (from: string, to: string) => {
    if (fs.existsSync(to)) return;

    fs.symlinkSync(fs.realpathSync(from), to, "junction");
  };

  for (const entry of fs.readdirSync(source)) {
    if (entry.startsWith(".")) continue;

    const from = path.join(source, entry);

    if (!entry.startsWith("@")) {
      if (fs.statSync(from).isDirectory()) link(from, path.join(destination, entry));

      continue;
    }

    fs.mkdirSync(path.join(destination, entry), { recursive: true });

    for (const child of fs.readdirSync(from)) {
      link(path.join(from, child), path.join(destination, entry, child));
    }
  }
}
