import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** What a built client folder contains, at least one of which proves it is one. */
const CLIENT_FOLDER_MARKERS = [".vite", "assets", "public"] as const;

/**
 * Where the client bundle of a build lives, as an absolute path.
 *
 * `clientDir` is baked into the page manifest relative to the application root
 * (`dist/client`), which is the right answer for `warlock start` run from the
 * project. A bundle that is copied somewhere else (`node app.js` from a copy of
 * `dist/`, a desktop app's resources folder) has no such path under its working
 * directory, but its `client` folder always sits next to the bundle file. When
 * this module runs inside that bundle, the sibling folder is used if it holds a
 * client build; otherwise the baked path is kept and later resolved against the
 * working directory as before.
 *
 * @param moduleUrl the URL of the running module; a parameter so a spec can place it
 */
export function resolveBuiltClientDir(
  clientDir: string,
  moduleUrl: string = import.meta.url,
): string {
  if (path.isAbsolute(clientDir)) return clientDir;

  let adjacent: string;

  try {
    adjacent = path.join(path.dirname(fileURLToPath(moduleUrl)), "client");
  } catch {
    return clientDir;
  }

  const isClientBuild = CLIENT_FOLDER_MARKERS.some((marker) =>
    existsSync(path.join(adjacent, marker)),
  );

  return isClientBuild ? adjacent : clientDir;
}
