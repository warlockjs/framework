/**
 * Lazily load `@warlock.js/herald` — the optional peer backing `.queue()`.
 *
 * Memoized: the dynamic import runs at most once. A missing package surfaces a
 * curated install message at use time rather than a boot-time resolution error
 * (the lazy-optional-peer pattern used across the framework's drivers).
 */
let heraldModule: typeof import("@warlock.js/herald") | undefined;

const INSTALL_INSTRUCTIONS = `
The notifications queue requires the @warlock.js/herald package.
Install it with:

  npm install @warlock.js/herald

Or with your preferred package manager:

  pnpm add @warlock.js/herald
  yarn add @warlock.js/herald
`.trim();

export async function loadHerald(): Promise<typeof import("@warlock.js/herald")> {
  if (heraldModule) {
    return heraldModule;
  }

  try {
    heraldModule = await import("@warlock.js/herald");
    return heraldModule;
  } catch {
    throw new Error(INSTALL_INSTRUCTIONS);
  }
}

/** The herald channel notification jobs are published to / consumed from. */
export const DEFAULT_QUEUE_CHANNEL = "notifications.dispatch";
