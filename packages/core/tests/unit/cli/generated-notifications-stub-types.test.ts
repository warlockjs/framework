import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { notificationControllersStub } from "../../../src/generations/stubs";

/**
 * `warlock add notifications` scaffolds
 * `src/app/notifications/controllers/notifications.controller.ts` from
 * `notificationControllersStub` (`src/generations/stubs.ts`). The release
 * gate's own acceptance run — scaffold a fresh app, `warlock add
 * notifications`, `tsc --noEmit` — found the generated file does NOT
 * compile when the raw `request.locals.user` value (untyped from core's own
 * perspective — see the 5.12.0 CHANGELOG: `RequestUser` moved out of core to
 * `@warlock.js/auth`) is forwarded straight into `inApp` instead of narrowed
 * to an id first. `notificationControllersStub`'s own `recipientId()` helper
 * exists to do that narrowing; this test pins that skipping it is a compile
 * error, not merely a style choice.
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

/** Virtual (never written to disk) file holding the CURRENT generated stub. */
const FIXED_STUB_FILE = `${CORE_DIR}/__generated-notifications-stub-types-test__/fixed.ts`;

/**
 * Virtual file holding the broken shape: `request.locals.user` forwarded
 * directly to `inApp`, skipping the stub's own `recipientId()` narrowing.
 */
const BROKEN_STUB_FILE = `${CORE_DIR}/__generated-notifications-stub-types-test__/broken.ts`;

const BROKEN_SNIPPET = `import { type RequestHandler } from "@warlock.js/core";
import { inApp } from "@warlock.js/notifications";

export const listNotificationsController: RequestHandler = async ({ request, response }) => {
  const { data, pagination } = await inApp.list(request.locals.user, request.all());

  return response.success({ notifications: data, pagination });
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

describe("notificationControllersStub type-checks against the real @warlock.js/core + @warlock.js/notifications declarations", () => {
  it(
    "compiles clean, and RED-CONTROL fails the un-narrowed request.locals.user shape",
    () => {
      const results = compileVirtualFiles({
        [FIXED_STUB_FILE]: notificationControllersStub,
        [BROKEN_STUB_FILE]: BROKEN_SNIPPET,
      });

      // The generated controller stub, as it actually ships, has zero
      // compile errors against the real declarations.
      expect(results[FIXED_STUB_FILE]).toEqual([]);

      // RED CONTROL: forwarding `request.locals.user` straight into `inApp`
      // (skipping the stub's own `recipientId()` narrowing) fails, with the
      // compiler's OWN message.
      expect(results[BROKEN_STUB_FILE]).toHaveLength(1);
      expect(results[BROKEN_STUB_FILE][0]).toContain(
        "is not assignable to parameter of type 'Notifiable | Id'",
      );
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
