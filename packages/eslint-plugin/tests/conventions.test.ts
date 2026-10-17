import { noAwaitLog } from "../src/rules/no-await-log";
import { noJsImportExtension } from "../src/rules/no-js-import-extension";
import { oneControllerPerFile } from "../src/rules/one-controller-per-file";
import { preferTypeDiscriminator } from "../src/rules/prefer-type-discriminator";
import { createRuleTester } from "./rule-tester";

const tester = createRuleTester();

tester.run("no-await-log", noAwaitLog, {
  valid: [
    "log.info('a', 'b', 'c');",
    "await log.flush();",
    "await mailer.send(message);",
    "await other.info('x');",
  ],
  invalid: [
    {
      code: "async function f() { await log.info('auth', 'login', 'ok'); }",
      output: "async function f() { log.info('auth', 'login', 'ok'); }",
      errors: [{ messageId: "unnecessary", data: { call: "log.info" } }],
    },
    {
      code: "async function f() { return await logger.error('x', 'y', error); }",
      output: "async function f() { return logger.error('x', 'y', error); }",
      errors: [{ messageId: "unnecessary" }],
    },
  ],
});

tester.run("one-controller-per-file", oneControllerPerFile, {
  valid: [
    "export const loginController: RequestHandler = async ({ request, response }) => response.success();",
    "export const loginController = async () => {};\nloginController.validation = { schema };",
    "export const schema = v.object({});\nexport function helper() {}",
  ],
  invalid: [
    {
      code: "export const loginController = async () => {};\nexport const logoutController = async () => {};",
      errors: [
        {
          messageId: "extra",
          data: { name: "logoutController", ordinal: "2nd", first: "loginController" },
        },
      ],
    },
    {
      code: "export const list: RequestHandler = async () => {};\nexport const show: GuardedRequestHandler = async () => {};\nexport async function removeController() {}",
      errors: [
        { messageId: "extra" },
        { messageId: "extra", data: { name: "removeController", ordinal: "3rd", first: "list" } },
      ],
    },
  ],
});

tester.run("prefer-type-discriminator", preferTypeDiscriminator, {
  valid: [
    "type Shape = { type: 'circle'; radius: number } | { type: 'square'; size: number };",
    "interface Node { kind: SyntaxKind }",
    "type Token = { kind: string };",
  ],
  invalid: [
    {
      code: "type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; size: number };",
      errors: [{ messageId: "kind" }, { messageId: "kind" }],
    },
    {
      code: "interface Event { kind: 'created' | 'deleted'; id: string }",
      errors: [{ messageId: "kind" }],
    },
  ],
});

tester.run("no-js-import-extension", noJsImportExtension, {
  valid: [
    "import { User } from './user.model';",
    "import pkg from 'some-package/index.js';",
    "export * from '../shared';",
    "import data from './data.json';",
  ],
  invalid: [
    {
      code: "import { User } from './user.model.js';",
      output: "import { User } from './user.model';",
      errors: [
        { messageId: "extension", data: { extension: ".js", specifier: "./user.model.js" } },
      ],
    },
    {
      code: 'export { helper } from "../utils/helper.js";\nexport * from "./types.js";',
      output: 'export { helper } from "../utils/helper";\nexport * from "./types";',
      errors: [{ messageId: "extension" }, { messageId: "extension" }],
    },
    {
      code: "const page = await import('./page.jsx');",
      output: "const page = await import('./page');",
      errors: [{ messageId: "extension" }],
    },
  ],
});
