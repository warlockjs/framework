import { command } from "../../commands/cli-command";
import { generatePostmanAction } from "./postman-generator.action";

/**
 * `warlock generate.postman` — write a Postman Collection v2.1.0 derived from the same
 * OpenAPI document `generate.openapi` produces, so the two never disagree.
 *
 * Routes are read in the same isolated child process `warlock build` uses; the conversion
 * itself is pure and runs in the CLI process.
 */
export const postmanGeneratorCommand = command({
  name: "generate.postman",
  description: "Generate a Postman collection (storage/postman/collection.json) from the routes",
  action: generatePostmanAction,
  preload: {
    warlockConfig: true,
  },
  options: [
    {
      text: "--out, -o",
      description: "Output file, relative to the project root (default storage/postman/collection.json)",
      type: "string",
    },
    {
      text: "--title",
      description: "Collection name (default: the name in package.json)",
      type: "string",
    },
    {
      text: "--server",
      description: "Value of {{baseUrl}} (default: built from the http config)",
      type: "string",
    },
    {
      text: "--include-pages",
      description: "Also include page (SSR) routes",
      type: "boolean",
    },
  ],
});
