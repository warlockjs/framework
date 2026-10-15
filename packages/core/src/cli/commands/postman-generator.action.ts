import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { colors } from "@mongez/copper";
import type { CommandActionData } from "../../commands/types";
import { collectOpenApiDocument } from "../../openapi/collect-openapi-document";
import { openApiToPostmanCollection } from "../../openapi/postman/openapi-to-postman-collection";
import type { PostmanItem } from "../../openapi/postman/postman-types";
import { resolveBuildConfig } from "../../production/resolve-build-config";
import { rootPath } from "../../utils/paths";
import { stringOption } from "./openapi-generator.action";

/** Where the collection goes unless `--out` says otherwise. */
export const DEFAULT_POSTMAN_OUTPUT = "storage/postman/collection.json";

function countRequests(items: readonly PostmanItem[]): number {
  return items.reduce((total, item) => total + ("item" in item ? countRequests(item.item) : 1), 0);
}

/**
 * Action behind `warlock generate.postman`.
 *
 * Gets the OpenAPI document exactly as `generate.openapi` does (same registration child, same
 * options), converts it to a Postman Collection v2.1.0 in this process and writes it as
 * pretty JSON to `--out` (default `storage/postman/collection.json`). The per-route gaps the
 * document builder found are printed as warnings. A child failure is fatal and rejects.
 */
export async function generatePostmanAction({ options }: CommandActionData): Promise<void> {
  const cwd = rootPath();
  const output = path.resolve(cwd, stringOption(options.out) ?? DEFAULT_POSTMAN_OUTPUT);

  const { document, warnings } = await collectOpenApiDocument({
    cwd,
    timeoutMs: resolveBuildConfig().routeRegistrationTimeoutMs,
    title: stringOption(options.title),
    server: stringOption(options.server),
    includePages: options.includePages === true,
  });

  const collection = openApiToPostmanCollection(document);

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(collection, null, 2)}\n`, "utf8");

  const folders = collection.item.filter((item) => "item" in item).length;

  console.log(
    colors.greenBright(
      `Postman collection written to ${output} (${folders} folder${folders === 1 ? "" : "s"}, ${countRequests(collection.item)} requests). Import it in Postman and set the {{token}} variable.`,
    ),
  );

  if (warnings.length > 0) {
    console.warn(colors.yellowBright(`\n${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`));

    for (const warning of warnings) {
      console.warn(`  - ${warning}`);
    }
  }
}
