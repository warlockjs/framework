import { colors } from "@mongez/copper";
import { fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import { rootPath } from "../../../utils";

/** What {@link insertIncludeEntry} did, or could not do, to the source it was given. */
export type IncludeInsertion =
  | { status: "added"; next: string }
  | { status: "already-present" }
  | { status: "unrecognised" };

/**
 * Insert one entry into the `include` array of a tsconfig's SOURCE TEXT.
 *
 * **String surgery, never parse-and-write.** The project template's
 * `tsconfig.json` carries `//` comments — it is JSONC, which TypeScript accepts
 * and `JSON.parse` rejects. A parse-first patch therefore throws on exactly the
 * projects a feature is generated into: `warlock add react-email` failed on
 * every freshly scaffolded app with
 *
 * ```
 * ✖ add <features...> failed
 * Expected double-quoted property name in JSON at position 454 (line 17 column 5)
 * ```
 *
 * where line 17 is the comment explaining the project's `moduleResolution`. And
 * even where a parse succeeded, writing the object back would silently delete
 * every comment in the file — comments that are load-bearing documentation
 * there.
 *
 * `shadcn.feature.ts`'s `addWebPathAlias` already reached this conclusion for
 * `compilerOptions.paths`; this is the same rule for `include`, kept in one
 * place so the next feature that needs it cannot get it wrong again.
 *
 * @param source The tsconfig file's current text.
 * @param entry The include entry to add, e.g. `"emails"`.
 * @returns What happened, and the new text when there is any.
 */
export function insertIncludeEntry(source: string, entry: string): IncludeInsertion {
  // Matches the entry whichever quote style the file uses, so a re-run against a
  // hand-edited tsconfig does not stack a second copy.
  if (new RegExp(`["']${escapeForRegExp(entry)}["']`).test(source)) {
    return { status: "already-present" };
  }

  const includeArray = /"include"\s*:\s*\[/.exec(source);

  if (!includeArray) {
    return { status: "unrecognised" };
  }

  const insertAt = includeArray.index + includeArray[0].length;

  return {
    status: "added",
    next: `${source.slice(0, insertAt)}${JSON.stringify(entry)}, ${source.slice(insertAt)}`,
  };
}

/**
 * Add one entry to the project's `tsconfig.json` `include` array.
 *
 * Never throws. A tsconfig this cannot patch produces a printed instruction the
 * developer can follow by hand — a feature must not abort a whole `add` because
 * one optional convenience could not be applied.
 *
 * @param entry The include entry to add, e.g. `"emails"`.
 * @param reason One line explaining what breaks without it, printed when the
 *               patch has to be handed back to the developer.
 */
export async function patchTsconfigInclude(entry: string, reason: string): Promise<void> {
  const tsconfigPath = rootPath("tsconfig.json");

  const printManualInstruction = (problem: string) => {
    console.log(
      `${colors.yellowBright("!")} ${colors.yellowBright("tsconfig.json")} ${problem} — ` +
        `add ${JSON.stringify(entry)} to its \`include\` array yourself.\n  ${reason}`,
    );
  };

  if (!(await fileExistsAsync(tsconfigPath))) {
    printManualInstruction("not found");

    return;
  }

  const insertion = insertIncludeEntry(await getFileAsync(tsconfigPath), entry);

  if (insertion.status === "already-present") {
    return;
  }

  if (insertion.status === "unrecognised") {
    printManualInstruction("has no recognisable `include` array");

    return;
  }

  await putFileAsync(tsconfigPath, insertion.next);
  console.log(`${colors.green("✓")} Added ${JSON.stringify(entry)} to tsconfig.json include`);
}

/**
 * Escape a literal string for embedding in a regular expression.
 *
 * @param value The literal to escape.
 * @returns The escaped literal.
 */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
