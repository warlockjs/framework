import path from "node:path";
import { fileURLToPath } from "node:url";
import { WarlockError } from "../errors/warlock-error";

/**
 * A typed, named slot that one module fills and others read: the supported way
 * to break an import cycle between modules, or to let a feature plug into one
 * that loads earlier, without a module-level variable nobody can find.
 *
 * Create it with {@link defineCapability}; the type parameter is the shape of
 * the implementation.
 */
export type Capability<T> = {
  /** The unique name; it is what `warlock inspect --section wiring` lists. */
  readonly name: string;
  /** What the capability is for, shown by `warlock inspect`. */
  readonly description?: string;
  /** Whether `warlock doctor` warns when nothing provides it at boot. */
  readonly required: boolean;
  /** Type-only marker that carries `T`; never set at runtime. */
  readonly __implementation?: T;
};

/** Options of {@link defineCapability}. */
export type DefineCapabilityOptions = {
  /** What the capability is for. */
  description?: string;
  /**
   * Whether the app is incomplete without a provider (default `true`).
   * `warlock doctor` warns about a required capability nobody provided at
   * boot; an optional one is read with {@link hasCapability} first.
   */
  required?: boolean;
};

/** What `warlock inspect` and `warlock doctor` know about one capability. */
export type CapabilityInfo = {
  name: string;
  description: string | null;
  required: boolean;
  provided: boolean;
  /** Absolute file that called {@link defineCapability}, when known. */
  definedIn: string | null;
  /** Absolute file that called {@link provideCapability}, when known. */
  providedBy: string | null;
  /** Absolute files that called {@link useCapability}, in first-use order. */
  consumers: string[];
};

/** Thrown by {@link useCapability} when nothing has provided the capability yet. */
export class CapabilityNotProvidedError extends WarlockError {
  public constructor(name: string, provided: readonly string[]) {
    super(
      "WL2008",
      `Capability "${name}" has no provider. Call provideCapability() for it from a module that loads at boot (main.ts, routes.ts or an event file).` +
        (provided.length > 0 ? ` Provided capabilities: ${provided.join(", ")}.` : ""),
    );
    this.name = "CapabilityNotProvidedError";
  }
}

type CapabilityRecord = {
  name: string;
  description: string | null;
  required: boolean;
  definedIn: string | null;
  provided: boolean;
  implementation: unknown;
  providedBy: string | null;
  consumers: Set<string>;
};

/**
 * Shared through `globalThis`: in a development process the framework can be
 * evaluated more than once (Node's loader and Vite's SSR runner each load a
 * copy), and a capability provided on one copy must be readable on the other.
 */
const registryKey = Symbol.for("warlock.js/core/capabilities");

type GlobalWithCapabilities = typeof globalThis & {
  [registryKey]?: Map<string, CapabilityRecord>;
};

function registry(): Map<string, CapabilityRecord> {
  const holder = globalThis as GlobalWithCapabilities;

  holder[registryKey] ??= new Map();

  return holder[registryKey];
}

const ownFile = (() => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return undefined;
  }
})();

/** The file of the nearest caller outside this module, from the stack. Best effort. */
function callerFile(): string | null {
  const frames = new Error().stack?.split("\n").slice(1) ?? [];

  for (const frame of frames) {
    const match = /(?:\(|\s)((?:file:\/\/)?[^()\s]+?):\d+:\d+\)?\s*$/.exec(frame);
    const location = match?.[1];

    if (!location) continue;

    let file = location;

    if (location.startsWith("file://")) {
      try {
        file = fileURLToPath(location);
      } catch {
        continue;
      }
    }

    // Stack frames use forward slashes on Windows; `ownFile` uses backslashes.
    if (file.startsWith("node:") || (ownFile && path.normalize(file) === path.normalize(ownFile))) {
      continue;
    }

    return file;
  }

  return null;
}

function recordFor(name: string): CapabilityRecord {
  const existing = registry().get(name);

  if (existing) return existing;

  const created: CapabilityRecord = {
    name,
    description: null,
    required: true,
    definedIn: null,
    provided: false,
    implementation: undefined,
    providedBy: null,
    consumers: new Set(),
  };

  registry().set(name, created);

  return created;
}

/**
 * Declare a capability: a named, typed slot another module provides.
 *
 * Defining the same name again (a hot reload, a second copy of the module)
 * updates the declaration and keeps the provider, so reloading never loses a
 * live implementation.
 *
 * @example
 * // src/app/billing/capabilities.ts
 * export const invoiceMailer = defineCapability<{ send(id: string): Promise<void> }>(
 *   "billing.invoiceMailer",
 *   { description: "Sends an invoice by email" },
 * );
 */
export function defineCapability<T>(
  name: string,
  options: DefineCapabilityOptions = {},
): Capability<T> {
  const record = recordFor(name);
  const required = options.required ?? true;

  record.description = options.description ?? null;
  record.required = required;
  record.definedIn = callerFile();

  return {
    name,
    required,
    ...(options.description !== undefined && { description: options.description }),
  };
}

/**
 * Fill a capability with its implementation, usually from a `main.ts`,
 * `routes.ts` or event file so it is ready before the first request. A second
 * call replaces the first.
 *
 * @example
 * // src/app/billing/main.ts
 * provideCapability(invoiceMailer, { send: sendInvoiceEmail });
 */
export function provideCapability<T>(capability: Capability<T>, implementation: T): void {
  const record = recordFor(capability.name);

  record.provided = true;
  record.implementation = implementation;
  record.providedBy = callerFile();
}

/**
 * Read a capability's implementation. Throws {@link CapabilityNotProvidedError}
 * (`WL2008`) when nothing provided it, which names the fix instead of failing
 * later with "x is not a function".
 *
 * @example
 * await useCapability(invoiceMailer).send(invoice.id);
 */
export function useCapability<T>(capability: Capability<T>): T {
  const record = recordFor(capability.name);

  if (!record.provided) {
    throw new CapabilityNotProvidedError(
      capability.name,
      [...registry().values()].filter((entry) => entry.provided).map((entry) => entry.name),
    );
  }

  const consumer = callerFile();

  if (consumer) record.consumers.add(consumer);

  return record.implementation as T;
}

/** Whether something has provided the capability. Does not count as a consumer. */
export function hasCapability<T>(capability: Capability<T>): boolean {
  return registry().get(capability.name)?.provided === true;
}

/** Every defined capability, sorted by name. What `warlock inspect` and `warlock doctor` read. */
export function listCapabilities(): CapabilityInfo[] {
  return [...registry().values()]
    .map((record) => ({
      name: record.name,
      description: record.description,
      required: record.required,
      provided: record.provided,
      definedIn: record.definedIn,
      providedBy: record.providedBy,
      consumers: [...record.consumers],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Forget every capability. For tests that need a clean registry; the
 * framework never calls it.
 */
export function resetCapabilities(): void {
  registry().clear();
}
