import { command } from "../../commands/cli-command";
import { generateOpenApiAction } from "./openapi-generator.action";

/**
 * `warlock generate.openapi` — write an OpenAPI 3.1 document derived from the registered
 * routes, handler validation, declared `responseSchema` and auth middleware.
 *
 * Named with a dot like `generate.typings`; the `generate` command itself is the scaffolder.
 * Routes are read in the same isolated child process `warlock build` uses, so no connector
 * is started and the app keeps running untouched.
 */
export const openApiGeneratorCommand = command({
  name: "generate.openapi",
  description: "Generate an OpenAPI 3.1 document (storage/openapi/openapi.json) from the routes",
  action: generateOpenApiAction,
  preload: {
    warlockConfig: true,
  },
  options: [
    {
      text: "--out, -o",
      description: "Output file, relative to the project root (default storage/openapi/openapi.json)",
      type: "string",
    },
    {
      text: "--title",
      description: "info.title (default: the name in package.json)",
      type: "string",
    },
    {
      text: "--server",
      description: "servers[0].url (default: built from the http config)",
      type: "string",
    },
    {
      text: "--include-pages",
      description: "Also document page (SSR) routes",
      type: "boolean",
    },
  ],
});
