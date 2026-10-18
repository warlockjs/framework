import { readFile } from "node:fs/promises";
import { parseSourceFile, type SourceFile } from "../tooling/syntax/ast";

/** Parse config syntax without resolving or executing its dependency graph. */
export async function readConfigAst(filePath: string): Promise<SourceFile | undefined> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
  return parseSourceFile(filePath, contents);
}
