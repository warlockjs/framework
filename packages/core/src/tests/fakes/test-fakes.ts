import type { GenericObject } from "@mongez/reinforcements";
import { config } from "../../config";
import { cacheFake } from "./cache-fake";
import { clockFake } from "./clock-fake";
import { idsFake } from "./ids-fake";
import { mailFake } from "./mail-fake";
import { queueFake } from "./queue-fake";
import { storageFake } from "./storage-fake";

/** The fakes the test kit installs. */
export const TEST_FAKE_NAMES = ["mail", "queue", "cache", "storage", "clock", "ids"] as const;

export type TestFakeName = (typeof TEST_FAKE_NAMES)[number];

/**
 * Which fakes to install.
 *
 * - `true` (the default) — all of them.
 * - `false` — none: real drivers, real clock, real ids.
 * - an object — all of them except the ones set to `false`, e.g.
 *   `{ cache: false }` keeps the configured cache driver.
 */
export type TestFakesSelection = boolean | Partial<Record<TestFakeName, boolean>>;

const fakes: Record<
  TestFakeName,
  { install(): void | Promise<void>; restore(): void | Promise<void> }
> = {
  mail: mailFake,
  queue: queueFake,
  cache: cacheFake,
  storage: storageFake,
  clock: clockFake,
  ids: idsFake,
};

let active: TestFakeName[] = [];

/** Read `tests.fakes` from `src/config/tests.ts`, or `undefined` when unset. */
export function readConfiguredFakes(): TestFakesSelection | undefined {
  // `config.get` resolves an absent key to `null`, not to its default's shape.
  const testsConfig = config.get<GenericObject>("tests", {}) ?? {};

  return validateSelection(testsConfig.fakes as unknown, "tests.fakes");
}

function validateSelection(value: unknown, source: string): TestFakesSelection | undefined {
  if (value === undefined || typeof value === "boolean") return value;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `${source} must be true, false, or an object such as { cache: false }; got ${JSON.stringify(value)}.`,
    );
  }

  const selection: Partial<Record<TestFakeName, boolean>> = {};

  for (const [key, flag] of Object.entries(value)) {
    const name = TEST_FAKE_NAMES.find((candidate) => candidate === key);

    if (!name) {
      throw new Error(
        `${source} has an unknown fake "${key}". Known fakes: ${TEST_FAKE_NAMES.join(", ")}.`,
      );
    }

    if (typeof flag !== "boolean") {
      throw new Error(`${source}.${key} must be true or false; got ${JSON.stringify(flag)}.`);
    }

    selection[name] = flag;
  }

  return selection;
}

/**
 * The fakes to install. Precedence: an explicit selection (the `fakes`
 * option of `setupTest()` / `startHttpTestServer()`) > `tests.fakes` in
 * `src/config/tests.ts` > all on.
 */
export function resolveTestFakes(explicit?: TestFakesSelection): TestFakeName[] {
  const selection =
    explicit !== undefined ? validateSelection(explicit, "fakes") : readConfiguredFakes();

  if (selection === undefined || selection === true) return [...TEST_FAKE_NAMES];
  if (selection === false) return [];

  return TEST_FAKE_NAMES.filter((name) => selection[name] !== false);
}

/**
 * Install the selected fakes. Called by `setupTest()` and
 * `startHttpTestServer()` once their connectors are up; call it yourself only
 * when you bootstrap the framework without them.
 *
 * @returns the fakes that are now installed.
 */
export async function installTestFakes(explicit?: TestFakesSelection): Promise<TestFakeName[]> {
  const selected = resolveTestFakes(explicit);

  for (const name of selected) {
    await fakes[name].install();
  }

  active = [...new Set([...active, ...selected])];

  return selected;
}

/**
 * Restore every installed fake, in reverse order. Every fake is restored even
 * when one fails; the failures are rethrown together afterwards.
 */
export async function restoreTestFakes(): Promise<void> {
  const errors: unknown[] = [];

  for (const name of [...active].reverse()) {
    try {
      await fakes[name].restore();
    } catch (error) {
      errors.push(error);
    }
  }

  active = [];

  if (errors.length > 0) throw new AggregateError(errors, "Restoring the test fakes failed.");
}

/** The fakes installed right now. */
export function installedTestFakes(): TestFakeName[] {
  return [...active];
}
