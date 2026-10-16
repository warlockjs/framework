#!/usr/bin/env node
/**
 * Compiler-cost benchmark for Seal's type inference (WR-001).
 *
 * Generates a large composed-schema project into a temporary directory — many
 * entity schemas with nested objects, arrays, unions, discriminated unions and
 * optional/default/nullable fields, chained into each other, then consumed by
 * service modules through `Infer.Input`/`Infer.Output`, `validate()` and
 * `~standard.validate` — and runs `tsc --noEmit --extendedDiagnostics` on it
 * against Seal's source.
 *
 * The fixture is deterministic, so instantiation and type counts are stable
 * between runs of the same source; memory and time are recorded for context
 * but never gated (they move with the machine and garbage collection).
 *
 * Usage (from the package root):
 *   node scripts/bench-types.mjs             measure and print
 *   node scripts/bench-types.mjs --check     fail when instantiations or types
 *                                            exceed the baseline by more than
 *                                            the tolerance (default 5%)
 *   node scripts/bench-types.mjs --update    measure and rewrite the baseline
 *
 * Options: --entities <n> (default 16), --services <n> (default 8),
 * --tolerance <fraction> (default 0.05), --keep (leave the fixture on disk),
 * --strict (with --check, also fail when the TypeScript version differs from
 * the baseline's; without it a mismatch is only a warning, because a compiler
 * upgrade moves instantiation counts on its own).
 *
 * Any compiler error — including TS2589 "excessively deep" — or a compiler
 * crash (out of heap) fails the run, and so does a metric the compiler output
 * no longer reports: a check that cannot read its numbers must not pass.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(scriptDir, "..");
const repoRoot = join(pkgRoot, "..", "..");
const baselinePath = join(pkgRoot, "bench", "types-baseline.json");
const require = createRequire(join(pkgRoot, "package.json"));
const tscPath = require.resolve("typescript/bin/tsc");
const tsVersion = require("typescript/package.json").version;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

function usageError(message) {
  console.error(`bench-types: ${message}`);
  process.exit(2);
}

/** A numeric option; refuses a missing, non-finite or out-of-range value. */
const option = (name, fallback, { integer = false, min = 0 } = {}) => {
  const index = args.indexOf(`--${name}`);

  if (index === -1) return fallback;

  const raw = args[index + 1];
  const value = Number(raw);

  if (raw === undefined || raw.startsWith("--") || !Number.isFinite(value) || value < min) {
    usageError(
      `--${name} needs a number >= ${min}, got ${raw === undefined ? "nothing" : `"${raw}"`}.`,
    );
  }

  if (integer && !Number.isInteger(value)) {
    usageError(`--${name} needs a whole number, got "${raw}".`);
  }

  return value;
};

const entities = option("entities", 16, { integer: true, min: 1 });
const services = option("services", 8, { integer: true, min: 1 });
const tolerance = option("tolerance", 0.05);

/** One entity schema module; every entity but each fourth nests the previous one. */
function entityModule(index) {
  const previous =
    index % 4 === 0 ? "" : `import { entity${index - 1} } from "./entity-${index - 1}";\n`;
  const nested = index % 4 === 0 ? "" : `  parent: entity${index - 1}.optional(),\n`;

  return `import { v, type Infer } from "@warlock.js/seal";
import { address, money } from "./shared";
${previous}
export const entity${index} = v.object({
  id: v.string(),
  name: v.string().min(1).max(200),
  status: v.literal("draft", "active", "archived").default("draft"),
  tags: v.array(v.string()).optional(),
  owner: v.object({
    id: v.int(),
    email: v.string().email().optional(),
    address,
  }),
  price: money,
  directive: v
    .discriminatedUnion("type", [
      v.object({ type: v.literal("create"), path: v.string() }),
      v.object({ type: v.literal("move"), from: v.string(), to: v.string() }),
      v.object({ type: v.literal("delete"), path: v.string(), force: v.boolean().optional() }),
    ])
    .optional(),
  payload: v.union([v.string(), v.int(), v.object({ raw: v.string() })]).nullable(),
  items: v.array(
    v.object({
      sku: v.string(),
      quantity: v.int().min(1),
      meta: v.record(v.string()).optional(),
    }),
  ),
  createdAt: v.date().nullable(),
${nested}});

export type Entity${index}Input = Infer.Input<typeof entity${index}>;
export type Entity${index}Output = Infer.Output<typeof entity${index}>;
`;
}

/** One service module composing three entities into a request and consuming the output. */
function serviceModule(index) {
  const picked = [];

  for (const seed of [index, index * 7 + 3, index * 13 + 5]) {
    let candidate = seed % entities;

    while (picked.includes(candidate)) candidate = (candidate + 1) % entities;

    picked.push(candidate);
  }

  const [a, b, c] = picked;

  return `import { v, validate, type Infer } from "@warlock.js/seal";
import { entity${a}, type Entity${a}Output } from "./entity-${a}";
import { entity${b} } from "./entity-${b}";
import { entity${c}, type Entity${c}Input } from "./entity-${c}";

export const request${index} = v.object({
  primary: entity${a},
  secondary: entity${b}.optional(),
  batch: v.array(entity${c}),
  mode: v.literal("dry-run", "apply").default("apply"),
});

export type Request${index} = Infer.Output<typeof request${index}>;

export function summarize${index}(entity: Entity${a}Output): string {
  return entity.owner.address.city + entity.status + (entity.tags?.join(",") ?? "");
}

export async function handle${index}(input: unknown, draft: Entity${c}Input) {
  const result = await validate(request${index}, input);

  if (!result.isValid) {
    return undefined;
  }

  const standard = await entity${b}["~standard"].validate(input);
  const directive = result.data.primary.directive;
  const target = directive?.type === "move" ? directive.to : directive?.path;

  return {
    summary: summarize${index}(result.data.primary),
    quantities: result.data.batch.map((entity) => entity.items.length),
    target,
    draft: draft.name,
    standard: standard.issues ? undefined : standard.value,
  };
}
`;
}

const sharedModule = `import { v } from "@warlock.js/seal";

export const address = v.object({
  line1: v.string(),
  line2: v.string().optional(),
  city: v.string(),
  country: v.literal("SA", "EG", "AE", "US"),
  geo: v.object({ lat: v.float(), lng: v.float() }).nullable(),
});

export const money = v.object({
  amount: v.number().min(0),
  currency: v.literal("SAR", "EGP", "USD").default("USD"),
});
`;

function writeFixture(root) {
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "shared.ts"), sharedModule);

  for (let index = 0; index < entities; index++) {
    writeFileSync(join(src, `entity-${index}.ts`), entityModule(index));
  }

  for (let index = 0; index < services; index++) {
    writeFileSync(join(src, `service-${index}.ts`), serviceModule(index));
  }

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          noEmit: true,
          typeRoots: [join(repoRoot, "node_modules", "@types")],
          types: ["node"],
          baseUrl: ".",
          paths: { "@warlock.js/seal": [join(pkgRoot, "src", "index.ts")] },
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
}

function readMetric(output, label) {
  const match = output.match(new RegExp(`^${label}:\\s+([\\d.]+)`, "m"));
  return match ? Number(match[1]) : undefined;
}

/** The metrics a check or a baseline update depends on. */
const GATED_METRICS = ["instantiations", "types"];

const root = mkdtempSync(join(tmpdir(), "seal-bench-types-"));
let failed = false;
let cleanedUp = false;

function cleanUp() {
  if (cleanedUp) return;
  cleanedUp = true;

  if (flag("keep")) {
    console.log(`Fixture kept at ${root}`);
  } else {
    rmSync(root, { recursive: true, force: true });
  }
}

// `finally` does not run when a signal ends the process. Ctrl+C also reaches
// the tsc child (same process group), so spawnSync returns and these handlers
// run before node exits.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanUp();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  writeFixture(root);

  const run = spawnSync(
    process.execPath,
    [tscPath, "-p", join(root, "tsconfig.json"), "--extendedDiagnostics"],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const output = `${run.stdout}${run.stderr}`;
  const errors = output.split("\n").filter((line) => /error TS\d+/.test(line));

  if (run.signal === "SIGINT" || run.signal === "SIGTERM") {
    console.error(`tsc was interrupted (${run.signal}).`);
    process.exitCode = 1;
    failed = true;
  } else if (run.status !== 0 && errors.length === 0) {
    console.error(
      `tsc crashed (exit ${run.status ?? run.signal}); likely out of heap.\n${output.slice(-2000)}`,
    );
    process.exitCode = 1;
    failed = true;
  } else {
    const result = {
      typescript: tsVersion,
      node: process.version,
      entities,
      services,
      files: readMetric(output, "Files"),
      types: readMetric(output, "Types"),
      instantiations: readMetric(output, "Instantiations"),
      memoryKB: readMetric(output, "Memory used"),
      checkTimeSeconds: readMetric(output, "Check time"),
      totalTimeSeconds: readMetric(output, "Total time"),
      errors: errors.length,
    };

    console.log(JSON.stringify(result, null, 2));

    if (errors.length > 0) {
      console.error(`\n${errors.length} compiler error(s):\n${errors.slice(0, 20).join("\n")}`);
      process.exitCode = 1;
      failed = true;
    }

    const unreadable = GATED_METRICS.filter((metric) => !Number.isFinite(result[metric]));

    if (!failed && unreadable.length > 0) {
      console.error(
        `Could not read ${unreadable.join(", ")} from the tsc output; the --extendedDiagnostics format may have changed.`,
      );
      process.exitCode = 1;
      failed = true;
    }

    if (!failed && flag("update")) {
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`\nBaseline written to ${baselinePath}`);
    }

    if (!failed && flag("check")) {
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

      const missing = GATED_METRICS.filter((metric) => !Number.isFinite(baseline[metric]));

      if (baseline.typescript !== tsVersion) {
        const message = `Baseline was recorded with TypeScript ${baseline.typescript}, this run uses ${tsVersion}; instantiation counts move with the compiler. Rerun with --update after checking the numbers.`;

        if (flag("strict")) {
          console.error(message);
          process.exitCode = 1;
        } else {
          console.warn(`Warning: ${message}`);
        }
      }

      if (missing.length > 0) {
        console.error(`Baseline has no usable ${missing.join(", ")}; rerun with --update.`);
        process.exitCode = 1;
      } else if (baseline.entities !== entities || baseline.services !== services) {
        console.error("Baseline was recorded with a different fixture size; rerun with --update.");
        process.exitCode = 1;
      } else {
        for (const metric of GATED_METRICS) {
          const budget = Math.ceil(baseline[metric] * (1 + tolerance));
          const growth = ((result[metric] - baseline[metric]) / baseline[metric]) * 100;

          console.log(
            `${metric}: ${result[metric]} (baseline ${baseline[metric]}, ${growth.toFixed(1)}%)`,
          );

          if (result[metric] > budget) {
            console.error(`${metric} exceeds the budget of ${budget}.`);
            process.exitCode = 1;
          }
        }
      }
    }
  }
} finally {
  cleanUp();
}
