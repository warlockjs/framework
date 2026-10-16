import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  listNotificationsControllerStub,
  listNotificationsSchemaStub,
  markAllNotificationsReadControllerStub,
  markNotificationReadControllerStub,
  markNotificationReadServiceStub,
  notificationResourceStub,
  notificationsRequestTypeStub,
  unreadNotificationsCountControllerStub,
} from "../../../src/generations/stubs";

/**
 * `warlock add notifications` scaffolds `src/app/notifications` from the
 * notification stubs in `src/generations/stubs.ts`. The release gate's own
 * acceptance run — scaffold a fresh app, `warlock add notifications`,
 * `tsc --noEmit` — once found a generated controller that did NOT compile:
 * `request.locals.user` is untyped from core's own perspective (see the
 * 5.12.0 CHANGELOG: `RequestUser` moved out of core to `@warlock.js/auth`).
 * Since 5.30.0 (FW-09) the controllers are typed with the module's own
 * `NotificationsRequestHandler`, whose request guarantees `locals.user.id`.
 * This test compiles the generated request type, schema, resource, service
 * and the four controllers together, and pins that a plain `RequestHandler`
 * reading `locals.user.id` is a compile error, not merely a style choice.
 *
 * `stub-handler-signature.test.ts` (this same directory's sibling under
 * `tests/unit/generations/`) documents an EARLIER attempt at exactly this
 * kind of guard and records it as abandoned: pointing `ts.createProgram` at
 * `@warlock.js/core`'s full barrel (`src/index.ts`) pulls in the whole
 * framework's transitive graph (~3000 source files) purely to type-check one
 * two-import file, at a cost that test measured at roughly 250s.
 *
 * Re-measured on this machine (see `PROGRAM_BUILD_ALLOWANCE_MS` below): a
 * `ts.createProgram` + `getPreEmitDiagnostics` pass against
 * `tsconfig.typecheck.json`'s REAL `paths` (source, not dist, so the check
 * tracks what actually ships) for a single virtual file cost ~50s total on a
 * warm run. That is real cost, not free — this file is deliberately the
 * ONLY spec in the suite that pays it, and it pays it once by compiling the
 * red-control snippet and the real stub in the SAME `ts.createProgram` call
 * (one graph build, two root files) rather than once per case.
 *
 * This is therefore a GENUINE compile against the real, shipped
 * `@warlock.js/core` + `@warlock.js/notifications` declarations — not a
 * text-matching stand-in. A text-matching test would have passed on the
 * broken stub (it contained the string `request.user`, same as the fix
 * does) and proven nothing.
 */

const CORE_DIR = path.resolve(__dirname, "../../..").split(path.sep).join("/");
const TSCONFIG_TYPECHECK_PATH = path.join(CORE_DIR, "tsconfig.typecheck.json");

/** Virtual (never written to disk) copy of the generated module, laid out as `warlock add` writes it. */
const MODULE_DIR = `${CORE_DIR}/__generated-notifications-stub-types-test__/notifications`;

const GENERATED_FILES: Record<string, string> = {
  [`${MODULE_DIR}/types/notifications-request.type.ts`]: notificationsRequestTypeStub,
  [`${MODULE_DIR}/schema/list-notifications.schema.ts`]: listNotificationsSchemaStub,
  [`${MODULE_DIR}/resources/notification.resource.ts`]: notificationResourceStub,
  [`${MODULE_DIR}/services/mark-notification-read.service.ts`]: markNotificationReadServiceStub,
  [`${MODULE_DIR}/controllers/list-notifications.controller.ts`]: listNotificationsControllerStub,
  [`${MODULE_DIR}/controllers/unread-notifications-count.controller.ts`]:
    unreadNotificationsCountControllerStub,
  [`${MODULE_DIR}/controllers/mark-notification-read.controller.ts`]:
    markNotificationReadControllerStub,
  [`${MODULE_DIR}/controllers/mark-all-notifications-read.controller.ts`]:
    markAllNotificationsReadControllerStub,
};

/**
 * Virtual file holding the broken shape: a plain `RequestHandler` reading
 * `request.locals.user.id`, without the module's guarded request type.
 */
const BROKEN_STUB_FILE = `${MODULE_DIR}/controllers/broken.controller.ts`;

const BROKEN_SNIPPET = `import { type RequestHandler } from "@warlock.js/core";
import { inApp } from "@warlock.js/notifications";

export const unreadNotificationsCountController: RequestHandler = async ({ request, response }) => {
  const count = await inApp.countUnread(request.locals.user.id);

  return response.success({ count });
};
`;

/** Loads the REAL typecheck compiler options — the same ones the release gate's own `tsc -p tsconfig.typecheck.json` run uses, `paths`-mapped to source. */
function loadTypecheckCompilerOptions(): ts.CompilerOptions {
  const configFile = ts.readConfigFile(TSCONFIG_TYPECHECK_PATH, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(
      `Failed to read ${TSCONFIG_TYPECHECK_PATH}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
    );
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, CORE_DIR);

  return parsed.options;
}

/**
 * Compiles a set of in-memory virtual files against the real
 * `@warlock.js/*` declaration graph, in ONE `ts.createProgram` call (so the
 * ~3000-file transitive graph is built once, not once per case), and returns
 * each file's own diagnostics as plain message strings.
 */
function compileVirtualFiles(files: Record<string, string>): Record<string, string[]> {
  const options = loadTypecheckCompilerOptions();
  const host = ts.createCompilerHost(options, true);
  const virtualPaths = new Set(Object.keys(files));

  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => virtualPaths.has(fileName) || originalFileExists(fileName);

  // Relative imports between the virtual files only resolve when their
  // directories are reported as existing; none of them exist on disk.
  const virtualDirectories = new Set(
    [...virtualPaths].flatMap((file) => {
      const parts = file.split("/");

      return parts.slice(1, -1).map((_, index) => parts.slice(0, index + 2).join("/"));
    }),
  );
  const originalDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (directory) =>
    virtualDirectories.has(directory.replace(/\/$/, "")) ||
    (originalDirectoryExists ? originalDirectoryExists(directory) : true);

  const originalReadFile = host.readFile.bind(host);
  host.readFile = (fileName) =>
    virtualPaths.has(fileName) ? files[fileName] : originalReadFile(fileName);

  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (virtualPaths.has(fileName)) {
      return ts.createSourceFile(
        fileName,
        files[fileName],
        languageVersionOrOptions,
        true,
        ts.ScriptKind.TS,
      );
    }

    return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram({ rootNames: [...virtualPaths], options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const byFile: Record<string, string[]> = {};
  for (const virtualPath of virtualPaths) byFile[virtualPath] = [];

  for (const diagnostic of diagnostics) {
    const fileName = diagnostic.file?.fileName;
    if (fileName && virtualPaths.has(fileName)) {
      byFile[fileName].push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }
  }

  return byFile;
}

describe("the generated notifications module type-checks against the real @warlock.js/core + @warlock.js/notifications declarations", () => {
  it(
    "compiles clean, and RED-CONTROL fails a plain RequestHandler reading locals.user.id",
    () => {
      const results = compileVirtualFiles({
        ...GENERATED_FILES,
        [BROKEN_STUB_FILE]: BROKEN_SNIPPET,
      });

      // Every generated file, as it actually ships, has zero compile errors
      // against the real declarations.
      for (const file of Object.keys(GENERATED_FILES)) {
        expect({ file, errors: results[file] }).toEqual({ file, errors: [] });
      }

      // RED CONTROL: without the guarded request type, `locals.user` is not
      // known to carry an id, so the compiler refuses the read.
      expect(results[BROKEN_STUB_FILE]?.length).toBeGreaterThan(0);
    },
    // Building the ~3000-file @warlock.js/* transitive graph from source is
    // genuinely slow (see the file-level doc comment) — this is the one
    // spec in the suite allowed a timeout this large, and it exists exactly
    // so that allowance is justified. Re-measured 2026-09-16 running core's
    // full `test` script back-to-back (competing with ~2300 other tests for
    // CPU): this case timed out at the previous 120_000ms bound, having
    // taken ~142s wall under that load versus ~75-80s when the suite is
    // otherwise idle. Raised well clear of the measured worst case rather
    // than nudged just above it, for the same reason
    // `add-command-process-exit.test.ts` documents for its own bound.
    240_000,
  );
});
