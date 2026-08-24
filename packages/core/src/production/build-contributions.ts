import type {
  Connector,
  ConnectorBuildContext,
  ConnectorEsbuildPatch,
} from "../connectors/types";

/**
 * `Error` with the `cause` option typed. Same shim as
 * `application.ts` — lib.es2022 declares `cause` on `ErrorOptions`, but the
 * package still compiles against an older lib in some consumers.
 */
type ErrorWithCauseConstructor = new (message: string, options: { cause: unknown }) => Error;

const ErrorWithCause = Error as ErrorWithCauseConstructor;

/**
 * The only keys a `build` contribution may carry.
 *
 * The runtime half of the closed-contribution constraint: the
 * type already makes `build: { plugins: [...] }` unrepresentable, but a
 * plain `warlock.config.js`, an `as any`, or a connector compiled against an
 * older core all slip past the type. Rejected rather than ignored — the same
 * posture as the `tsconfig` guard in `resolve-build-config`: dropping the key
 * quietly would leave the author believing their plugin ran.
 */
const ALLOWED_CONTRIBUTION_KEYS = ["generate", "emit"] as const;

/**
 * What the generate pass produced, merged across every contributor.
 */
export type GenerateContributionsResult = {
  /** Entry lines in contributor order, appended after `./routes` */
  entryImports: string[];
  /** The contributors' esbuild patches, merged into one */
  esbuild: ConnectorEsbuildPatch;
};

/**
 * Reject a contribution object carrying anything but the two hooks.
 *
 * @throws Error naming the connector and the offending key
 */
export function assertClosedContribution(connector: Connector): void {
  const contribution = connector.build;

  if (!contribution) return;

  for (const key of Object.keys(contribution)) {
    if ((ALLOWED_CONTRIBUTION_KEYS as readonly string[]).includes(key)) continue;

    throw new Error(
      `Connector "${connector.name}" declares an unsupported build contribution key "${key}". ` +
        `A build contribution carries exactly two optional hooks — ` +
        `${ALLOWED_CONTRIBUTION_KEYS.join(" and ")} — and no data. ` +
        `Anything a hook needs (plugins, pipelines, aliases) must be constructed inside ` +
        `that hook, so it never lands in the connector's static import graph.`,
    );
  }
}

/**
 * Drain every connector's `generate` hook, in array order, sequentially.
 *
 * Semantics are copied from `Application.runStartupValidators`
 * (`application.ts:304-329`) on purpose: ordered, awaited one at a time, and
 * a throw is rethrown wrapped in an error NAMING the contributor. A
 * contributor failure IS the build failing — that is what makes
 * "green build, no client bundle" unrepresentable rather than merely
 * unlikely.
 */
export async function runGenerateContributions(
  connectors: readonly Connector[],
  context: ConnectorBuildContext,
): Promise<GenerateContributionsResult> {
  const entryImports: string[] = [];
  let esbuild: ConnectorEsbuildPatch = {};

  for (const connector of connectors) {
    assertClosedContribution(connector);

    const generate = connector.build?.generate;

    if (!generate) continue;

    const result = await runHook(connector, "generate", () => generate(context));

    if (!result) continue;

    if (result.entryImports) {
      entryImports.push(...result.entryImports);
    }

    if (result.esbuild) {
      esbuild = mergeEsbuildPatches(esbuild, result.esbuild);
    }
  }

  return { entryImports, esbuild };
}

/**
 * Drain every connector's `emit` hook, in array order, sequentially.
 *
 * Runs after esbuild and before `.warlock/production` is removed, so a hook
 * may still read what `generate` wrote there.
 */
export async function runEmitContributions(
  connectors: readonly Connector[],
  context: ConnectorBuildContext,
): Promise<void> {
  for (const connector of connectors) {
    assertClosedContribution(connector);

    const emit = connector.build?.emit;

    if (!emit) continue;

    await runHook(connector, "emit", () => emit(context));
  }
}

/**
 * Merge two contributor patches. Later wins, except:
 *
 * - `define` merges per key — two contributors defining different
 *   `import.meta.env.*` entries must both survive; a wholesale replace would
 *   drop one silently.
 * - `external` concatenates and dedupes — it is a set of package names, and
 *   under `singleBundle` each contributor adds its own optional peers.
 * - `loader` merges per extension, for the same reason as `define`.
 */
export function mergeEsbuildPatches(
  base: ConnectorEsbuildPatch,
  patch: ConnectorEsbuildPatch,
): ConnectorEsbuildPatch {
  const merged: ConnectorEsbuildPatch = { ...base, ...patch };

  if (base.define || patch.define) {
    merged.define = { ...base.define, ...patch.define };
  }

  if (base.external || patch.external) {
    merged.external = dedupe([...(base.external ?? []), ...(patch.external ?? [])]);
  }

  if (base.loader || patch.loader) {
    merged.loader = { ...base.loader, ...patch.loader };
  }

  return merged;
}

/**
 * Concatenation order preserved — esbuild does not care, but a stable order
 * keeps build output diffable.
 */
export function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Run one hook and rename its failure after the connector that owns it.
 */
async function runHook<Result>(
  connector: Connector,
  hook: "generate" | "emit",
  run: () => Result | Promise<Result>,
): Promise<Result> {
  try {
    return await run();
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);

    throw new ErrorWithCause(
      `Build contribution "${connector.name}" failed during ${hook}: ${cause}. ` +
        `The build cannot continue — an artifact this connector was responsible for ` +
        `is missing, and shipping the bundle without it would fail at runtime instead.`,
      { cause: error },
    );
  }
}
