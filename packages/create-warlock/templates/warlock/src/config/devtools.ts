/**
 * Devtools settings. Devtools runs only in development, and only when
 * `@warlock.js/devtools` is installed (`warlock add devtools`). Without it this
 * file is not read.
 */
export default {
  /** Adds the Grimoire tab: features, flows, the book and the check report. */
  panels: ["@warlock.js/grimoire/devtools"],
};
