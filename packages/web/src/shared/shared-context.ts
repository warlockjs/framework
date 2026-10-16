import { createContext, type Context } from "react";

/**
 * One registry for every React context `@warlock.js/web` owns, in a
 * `Symbol.for` slot on `globalThis` — the same realm-wide slot pattern
 * `routing/route-table` uses for its table.
 *
 * Why (FW-07): a context is identified by its OBJECT. When the dev server
 * evaluates a framework module a second time (an SSR module-graph
 * invalidation after an app edit, or a second copy of the package), a plain
 * module-level `createContext()` yields a new context, and a provider from one
 * evaluation cannot satisfy a hook from the other: `useLocale()` then reports
 * it was "called outside Warlock's LocaleProvider" until the server restarts.
 * Reading the context from here makes every evaluation share the first one.
 */
const CONTEXT_REGISTRY_SLOT = Symbol.for("warlock.web.reactContexts");

type ContextRegistry = Map<string, Context<unknown>>;

function registry(): ContextRegistry {
  const holder = globalThis as unknown as Record<symbol, ContextRegistry | undefined>;
  let contexts = holder[CONTEXT_REGISTRY_SLOT];

  if (contexts === undefined) {
    contexts = new Map();
    holder[CONTEXT_REGISTRY_SLOT] = contexts;
  }

  return contexts;
}

/** The context registered under `name`, created on first use. */
export function sharedContext<T>(name: string, defaultValue: T): Context<T> {
  const contexts = registry();
  const existing = contexts.get(name);

  if (existing !== undefined) return existing as Context<T>;

  const context = createContext<T>(defaultValue);
  context.displayName = name;
  contexts.set(name, context as Context<unknown>);

  return context;
}
