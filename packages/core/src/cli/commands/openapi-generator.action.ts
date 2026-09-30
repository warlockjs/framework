import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { colors } from "@mongez/copper";
import type { CommandActionData } from "../../commands/types";
import { collectOpenApiDocument } from "../../openapi/collect-openapi-document";
import { resolveBuildConfig } from "../../production/resolve-build-config";
import { rootPath } from "../../utils/paths";

/** Where the document goes unless `--out` says otherwise. */
export const DEFAULT_OPENAPI_OUTPUT = "storage/openapi/openapi.json";

type OptionValue = CommandActionData["options"][string];

function stringOption(value: OptionValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Action behind `warlock generate.openapi`.
 *
 * Builds the OpenAPI 3.1 document in a fresh registration child (no connectors are booted),
 * writes it as pretty JSON to `--out` (default `storage/openapi/openapi.json`) and prints the
 * per-route gaps it found as warnings. A child failure is fatal and rejects; gaps never are.
 */
export async function generateOpenApiAction({ options }: CommandActionData): Promise<void> {
  const cwd = rootPath();
  const output = path.resolve(cwd, stringOption(options.out) ?? DEFAULT_OPENAPI_OUTPUT);

  const { document, warnings } = await collectOpenApiDocument({
    cwd,
    timeoutMs: resolveBuildConfig().routeRegistrationTimeoutMs,
    title: stringOption(options.title),
    server: stringOption(options.server),
    includePages: options.includePages === true,
  });

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const operations = Object.values(document.paths).reduce(
    (total, item) => total + Object.keys(item).length,
    0,
  );

  console.log(
    colors.greenBright(
      `OpenAPI ${document.openapi} written to ${output} (${Object.keys(document.paths).length} paths, ${operations} operations).`,
    ),
  );

  if (warnings.length > 0) {
    console.warn(colors.yellowBright(`\n${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`));

    for (const warning of warnings) {
      console.warn(`  - ${warning}`);
    }
  }
}
