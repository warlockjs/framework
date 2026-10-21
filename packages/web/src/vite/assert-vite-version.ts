/**
 * The Vite major this `@warlock.js/web` release configures its builds for.
 * `build.rolldownOptions` (the vendor split) and the development server's JSX
 * setup exist only on Vite 8, and Vite 7 ignores them silently.
 */
export const REQUIRED_VITE_MAJOR = 8;

/**
 * Returns the major of a Vite version string such as `8.3.3`, or `undefined`
 * when the string does not start with a number followed by a dot.
 */
export function viteMajorOf(version: string): number | undefined {
  const match = /^\s*(\d+)\./.exec(version);

  return match === null ? undefined : Number(match[1]);
}

/**
 * Throws a clear error when the installed Vite is older than
 * {@link REQUIRED_VITE_MAJOR}. Without it an app that upgraded Warlock but kept
 * Vite 7 fails inside `warlock build` with "Could not resolve entry module".
 *
 * A version that cannot be parsed passes: an unknown build is not blocked.
 *
 * @param version The `version` export of the `vite` module the caller imports.
 */
export function assertViteVersion(version: string): void {
  const major = viteMajorOf(version);

  if (major === undefined || major >= REQUIRED_VITE_MAJOR) {
    return;
  }

  throw new Error(
    `@warlock.js/web 5.36 requires Vite ${REQUIRED_VITE_MAJOR} (found ${version}). ` +
      `Run "npx warlock upgrade --from 5.35 --to 5.36.0" or install vite@^${REQUIRED_VITE_MAJOR} ` +
      "and @vitejs/plugin-react@^6.",
  );
}
