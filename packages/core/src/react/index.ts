import { createRequire } from "node:module";
import type { ComponentType, ReactElement, ReactNode } from "react";

// ============================================================
// Lazily Resolved React Modules
// ============================================================

/**
 * Installation instructions for React
 */
const REACT_INSTALL_INSTRUCTIONS = `
React SSR functionality requires React packages.
Install them with:

  warlock add react

Or manually:

  npm install react react-dom
  pnpm add react react-dom
  yarn add react react-dom
`.trim();

/**
 * Cached React modules, populated by the first `resolveReactModules()` call
 */
let react: typeof import("react") | null = null;
let reactDomServer: typeof import("react-dom/server") | null = null;

/**
 * Whether the resolution attempt already ran (success or failure)
 */
let reactResolved = false;

/**
 * Why the resolution failed, when it failed.
 *
 * Cached and re-thrown on every later call: the resolution attempt runs exactly
 * once, so without this the second `renderReact()` would skip the attempt and
 * fall through to the "not installed" branch, reporting a different, wrong
 * cause one call after the accurate one.
 */
let reactLoadError: Error | null = null;

/**
 * `new Error(message, { cause })` is ES2022, and this package still compiles
 * against the ES2020 lib (see #16), where `Error` is typed as taking a message
 * only. Node has supported the option since v16, so this is the type layer
 * catching up with the runtime, not a change in what the code does.
 */
type ErrorWithCauseConstructor = new (message: string, options: { cause: unknown }) => Error;

const ErrorWithCause = Error as ErrorWithCauseConstructor;

/**
 * Whether `error` says `specifier` itself is absent, as opposed to present but
 * broken.
 *
 * Both halves are load-bearing. `MODULE_NOT_FOUND` alone is not enough: a
 * dependency missing *inside* react raises the very same code (`Cannot find
 * module 'scheduler'`), and treating that as absence would tell the operator to
 * install a package they already have. So the message has to name the specifier
 * exactly — quoted, which is also what stops `'react-dom'` from matching a
 * check for `'react'`.
 */
function isModuleMissing(error: unknown, specifier: string): boolean {
  if (!(error instanceof Error)) return false;

  return (
    (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND" &&
    error.message.includes(`Cannot find module '${specifier}'`)
  );
}

/**
 * Require one module, translating its failure into a message that names the
 * specifier that actually failed.
 *
 * The two specifiers are resolved separately and reported separately: a broken
 * `react-dom/server` must never be announced as "react is not installed", since
 * that sends the operator to fix a package that is already fine.
 */
function requireModule<T>(require: NodeRequire, specifier: string): T {
  try {
    const module = require(specifier);

    return (module.default ?? module) as T;
  } catch (error) {
    if (isModuleMissing(error, specifier)) {
      throw new Error(`${specifier} is not installed.\n\n${REACT_INSTALL_INSTRUCTIONS}`);
    }

    // The package is there, it just would not load. Its own error names the
    // real cause, so it is inlined *and* chained: a terminal that never prints
    // `cause` must still show the text that actually helps.
    throw new ErrorWithCause(`Failed to load "${specifier}": ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * Resolve the React modules synchronously, on first use.
 *
 * Resolution is deliberately *lazy* and *synchronous*:
 *
 * - Lazy, because a top-level require would drag react and react-dom into every
 *   `import "@warlock.js/core"`, including apps that never render a component.
 * - Synchronous, because `renderReact()` is synchronous. An async import kicked
 *   off at module load leaves a window in which the modules are neither loaded
 *   nor known to be missing, and a render running inside that window has no
 *   correct answer to give — it used to read `createElement` off `undefined`.
 *
 * `createRequire` gives an ESM-safe `require`, and the outcome — modules,
 * absence or load failure — is cached, so resolution runs exactly once per
 * process. The failure *reason* is cached too, not just the fact of it: every
 * call after a failed load has to report the same cause as the first one.
 *
 * @throws when react or react-dom is not installed, or cannot be loaded
 */
function resolveReactModules() {
  if (!reactResolved) {
    reactResolved = true;

    try {
      const require = createRequire(import.meta.url);
      react = requireModule<typeof import("react")>(require, "react");
      reactDomServer = requireModule<typeof import("react-dom/server")>(require, "react-dom/server");
    } catch (error) {
      react = null;
      reactDomServer = null;
      reactLoadError = error as Error;
    }
  }

  if (reactLoadError) {
    throw reactLoadError;
  }

  if (!react || !reactDomServer) {
    throw new Error(`react is not installed.\n\n${REACT_INSTALL_INSTRUCTIONS}`);
  }

  return { react, reactDomServer };
}

// ============================================================
// Render Function
// ============================================================

/**
 * Render a React element/component to HTML string
 *
 * **Important:** This function requires React packages to be installed.
 * Install them with: `warlock add react` or `yarn add react react-dom`
 *
 * React is resolved synchronously on the first call that needs it, so this
 * function stays synchronous and missing packages throw here rather than
 * surfacing later as a read off an undefined module.
 *
 * @example
 * ```typescript
 * const html = renderReact(<WelcomeEmail name="John" />);
 * ```
 */
export function renderReact(reactElement: ReactElement | ComponentType | ReactNode): string {
  const { react, reactDomServer } = resolveReactModules();

  if (typeof reactElement === "function") {
    reactElement = react.createElement(reactElement);
  }

  return reactDomServer.renderToString(reactElement);
}
